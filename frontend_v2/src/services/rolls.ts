/**
 * Phase 54: Roll Tracking API Service
 * Frontend service for roll operations: list, detail, genealogy, move, reserve, consume
 */

import { api } from '@/lib/api';

// Types
export interface Roll {
    id: string;
    label_id: string;
    material: string;
    material_name: string;
    material_code: string;
    batch_no: string;
    grade: string | null;  // Phase 56: FK to RecipeGrade
    grade_name: string | null;  // Phase 56: Grade name
    plant: string | null;  // Phase 56: FK to Plant
    plant_name: string | null;  // Phase 56: Plant name
    thickness_micron: number;
    width_mm: number;
    length_m: number;
    original_weight_kg: number;
    weight_kg: number;
    location: string;
    location_name: string;
    status: 'AVAILABLE' | 'RESERVED' | 'IN_PROCESS' | 'SENT_JOBWORK' | 'CONSUMED' | 'SCRAPPED';
    stage_index: number;
    stage_name: string;
    roll_role?: string;
    is_quarantined?: boolean;
    is_fg: boolean;
    current_step_index: number;
    created_by_job?: string;
    created_process?: string;
    created_at: string;
}

export interface RollLink {
    id: string;
    parent_roll: string;
    parent_label: string;
    child_roll: string;
    child_label: string;
    relation_type: 'SPLIT' | 'MERGE' | 'PROCESS_OUTPUT';
    qty_used_kg: number;
    created_at: string;
}

export interface RollMovement {
    id: string;
    roll: string;
    roll_label: string;
    from_location: string | null;
    from_location_name: string | null;
    to_location: string;
    to_location_name: string;
    reason: string;
    reason_note: string;
    job: string | null;
    job_no: string | null;
    moved_by: string | null;
    moved_by_name: string | null;
    timestamp: string;
}

export interface RollConsumption {
    id: string;
    job: string;
    job_no: string;
    process: string;
    process_name: string;
    input_roll: string;
    input_roll_label: string;
    output_roll: string | null;
    output_roll_label: string | null;
    balance_roll: string | null;
    balance_roll_label: string | null;
    scrap_roll: string | null;
    scrap_roll_label: string | null;
    consumed_kg: number;
    scrap_kg: number;
    balance_kg: number;
    output_kg: number;
    machine: string;
    machine_name: string;
    operator: string | null;
    operator_name: string | null;
    timestamp: string;
    notes: string;
}

export interface RollDetail extends Roll {
    location_type: string;
    parent_links: RollLink[];
    child_links: RollLink[];
    recent_movements: RollMovement[];
    consumptions: RollConsumption[];
    meta_json: Record<string, unknown>;
}

export interface GenealogyNode {
    roll_id: string;
    label_id: string;
    relation_type: string;
    qty_used_kg: number;
    stage_index?: number;
    weight_kg?: number;
    status?: string;
}

export interface GenealogyResponse {
    roll: RollDetail;
    ancestors: GenealogyNode[];
    descendants: GenealogyNode[];
}

export interface RollsByStage {
    [stage: string]: Roll[];
}

export interface RollExplorerRow {
    id: string;
    label_id: string;
    roll_role?: string | null;
    origin_type?: "IN_HOUSE" | "PURCHASED" | "JOBWORK_RETURN" | "INTERPLANT_IN" | "REMAINDER" | string;
    origin_label?: string | null;
    stock_strategy?: "FINAL_STOCK" | "INTERMEDIATE_POOL" | "PACKAGING_STOCK" | string;
    stock_strategy_label?: string | null;
    family_display_name?: string | null;
    display_name?: string | null;
    variant_display_name?: string | null;
    size_line?: string | null;
    form_label?: string | null;
    process_state_label?: string | null;
    availability_label?: string | null;
    print_status?: string | null;
    lamination_status?: string | null;
    reporting_group?: string | null;
    variant_summary?: string | null;
    consumability_mode?: string | null;
    is_quarantined?: boolean;
    status: string;
    stage_name: string;
    bucket_label: string;
    source_stage_name?: string | null;
    material_id?: string | null;
    material_name?: string | null;
    grade_id?: string | null;
    grade_name?: string | null;
    weight_kg: number;
    width_mm?: number;
    thickness_micron?: number;
    location_id?: string | null;
    location_name?: string | null;
    plant_id?: string | null;
    plant_name?: string | null;
    created_job_id?: string | null;
    created_job_number?: string | null;
    production_job_id?: string | null;
    production_job_number?: string | null;
    created_at?: string | null;
}

export interface RollExplorerBucket {
    key: string;
    label: string;
    roll_count: number;
    weight_kg: number;
    rolls: RollExplorerRow[];
}

export interface RollExplorerResponse {
    meta: {
        mode: 'grouped' | 'table' | string;
        filters: Record<string, string | null | undefined>;
    };
    totals: {
        roll_count: number;
        weight_kg: number;
        remainder_roll_count: number;
        remainder_weight_kg: number;
    };
    buckets: RollExplorerBucket[];
    rows: RollExplorerRow[];
}

export interface RollVariantPlantSummary {
    plant_name: string;
    locations: string[];
    available_kg: number;
    reserved_kg: number;
    blocked_kg: number;
}

export interface RollExplorerVariant {
    variant_key: string;
    variant_display_name: string;
    size_line: string;
    form_label: string;
    stage_name: string;
    print_status: string;
    lamination_status: string;
    stock_strategy: string;
    stock_strategy_label: string;
    roll_count: number;
    available_kg: number;
    reserved_kg: number;
    blocked_kg: number;
    oldest_age_days: number;
    plant_summary: RollVariantPlantSummary[];
    rolls: RollExplorerRow[];
}

export interface RollExplorerFamily {
    family_key: string;
    family_display_name: string;
    form_label: string;
    reporting_group: string;
    total_roll_count: number;
    total_available_kg: number;
    total_reserved_kg: number;
    total_blocked_kg: number;
    oldest_age_days: number;
    variants: RollExplorerVariant[];
}

export interface RollByVariantResponse {
    meta: {
        filters: Record<string, string | null | undefined>;
    };
    totals: RollExplorerResponse["totals"];
    families: RollExplorerFamily[];
}

// API Functions

/**
 * List all rolls with optional filtering
 */
export async function listRolls(params?: {
    status?: string;
    stage_index?: number;
    location?: string;
    material?: string;
    is_fg?: boolean;
}): Promise<Roll[]> {
    const response = await api.get('/api/inventory/rolls/', { params });
    return response.data;
}

/**
 * Get single roll detail with genealogy and movements
 */
export async function getRoll(id: string): Promise<RollDetail> {
    const response = await api.get(`/api/inventory/rolls/${id}/`);
    return response.data;
}

/**
 * Get full genealogy tree for a roll
 */
export async function getGenealogyTree(id: string): Promise<GenealogyResponse> {
    const response = await api.get(`/api/inventory/rolls/${id}/genealogy/`);
    return response.data;
}

/**
 * Get rolls grouped by production stage (for Roll Explorer)
 */
export async function getRollsByStage(plantId?: string): Promise<RollsByStage> {
    const params = plantId ? { plant: plantId } : {};
    const response = await api.get('/api/inventory/rolls/by-stage/', { params });
    return response.data;
}

export async function getRollExplorer(params?: {
    plant?: string;
    stage?: string;
    roll_role?: string;
    origin_type?: string;
    stock_strategy?: string;
    status?: string;
    material?: string;
    grade?: string;
    family?: string;
    location?: string;
    job_number?: string;
    date_from?: string;
    date_to?: string;
    weight_min?: number;
    weight_max?: number;
    mode?: 'grouped' | 'table';
}): Promise<RollExplorerResponse> {
    const response = await api.get('/api/inventory/rolls/explorer/', { params });
    return response.data;
}

export async function getRollsByVariant(params?: {
    plant?: string;
    stage?: string;
    roll_role?: string;
    origin_type?: string;
    stock_strategy?: string;
    status?: string;
    material?: string;
    grade?: string;
    family?: string;
    location?: string;
    job_number?: string;
    date_from?: string;
    date_to?: string;
    weight_min?: number;
    weight_max?: number;
}): Promise<RollByVariantResponse> {
    const response = await api.get('/api/inventory/rolls/by-variant/', { params });
    return response.data;
}

/**
 * Phase 56: Get rolls for WCM Terminal with filters
 */
export async function getForWCM(params?: {
    material?: string;
    thickness_min?: number;
    thickness_max?: number;
    grade?: string;
    stage_index?: number;
    location?: string;
    plant?: string;
}): Promise<Roll[]> {
    const response = await api.get('/api/inventory/rolls/for-wcm/', { params });
    return response.data;
}

/**
 * Move a roll to a new location
 */
export async function moveRoll(
    rollId: string,
    toLocationId: string,
    reason: string,
    reasonNote?: string,
    jobId?: string
): Promise<{ status: string; movement: RollMovement }> {
    const response = await api.post(`/api/inventory/rolls/${rollId}/move/`, {
        to_location_id: toLocationId,
        reason,
        reason_note: reasonNote || '',
        job_id: jobId || null,
    });
    return response.data;
}

/**
 * Reserve multiple rolls for a production job
 */
export async function reserveRolls(
    rollIds: string[],
    jobId: string
): Promise<{ status: string; count: number; rolls: Roll[] }> {
    const response = await api.post('/api/inventory/rolls/reserve/', {
        roll_ids: rollIds,
        job_id: jobId,
    });
    return response.data;
}

/**
 * Release reserved rolls back to available
 */
export async function releaseRolls(
    rollIds: string[]
): Promise<{ status: string; count: number }> {
    const response = await api.post('/api/inventory/rolls/release/', {
        roll_ids: rollIds,
    });
    return response.data;
}

export async function quarantineRoll(rollId: string, reason?: string): Promise<{ status: string; roll: Roll }> {
    const response = await api.post(`/api/inventory/rolls/${rollId}/quarantine/`, { reason });
    return response.data;
}

export async function unquarantineRoll(rollId: string): Promise<{ status: string; roll: Roll }> {
    const response = await api.post(`/api/inventory/rolls/${rollId}/unquarantine/`);
    return response.data;
}

/**
 * Consume rolls for a production job
 * Creates output, balance, and scrap rolls automatically
 */
export async function consumeRolls(params: {
    jobId: string;
    processId: string;
    machineId: string;
    inputs: Array<{
        rollId: string;
        usedKg: number;
        scrapKg?: number;
    }>;
    outputLocationId?: string;
    notes?: string;
}): Promise<{
    status: string;
    results: Array<{
        input_roll: string;
        output_roll: string | null;
        balance_roll: string | null;
        scrap_roll: string | null;
    }>;
}> {
    const response = await api.post('/api/inventory/rolls/consume/', {
        job_id: params.jobId,
        process_id: params.processId,
        machine_id: params.machineId,
        inputs: params.inputs.map((input) => ({
            roll_id: input.rollId,
            used_kg: input.usedKg,
            scrap_kg: input.scrapKg || 0,
        })),
        output_location_id: params.outputLocationId || null,
        notes: params.notes || '',
    });
    return response.data;
}

/**
 * Get roll movements (movement log)
 */
export async function listRollMovements(params?: {
    roll?: string;
    from_location?: string;
    to_location?: string;
    reason?: string;
}): Promise<RollMovement[]> {
    const response = await api.get('/api/inventory/roll-movements/', { params });
    return response.data;
}

/**
 * Get roll consumptions (for scrap analytics)
 */
export async function listRollConsumptions(params?: {
    job?: string;
    process?: string;
    machine?: string;
}): Promise<RollConsumption[]> {
    const response = await api.get('/api/inventory/roll-consumptions/', { params });
    return response.data;
}

// Default export with all functions
const rollsApi = {
    listRolls,
    getRoll,
    getGenealogyTree,
    getRollsByStage,
    getRollExplorer,
    getRollsByVariant,
    moveRoll,
    reserveRolls,
    releaseRolls,
    quarantineRoll,
    unquarantineRoll,
    consumeRolls,
    listRollMovements,
    listRollConsumptions,
};

export default rollsApi;
