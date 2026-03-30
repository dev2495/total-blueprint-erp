import { api } from "@/lib/api";

type MaybePaginated<T> = T[] | { results?: T[] } | unknown;

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[];
    }
    return [];
}

export interface Plant {
    id: string;
    name: string;
    code: string;
    default_cost_absorption_group?: string | null;
    default_cost_absorption_group_code?: string | null;
    include_in_official_reports?: boolean;
    location_count?: number;
    work_center_count?: number;
    machine_count?: number;
    legal_profile?: {
        legal_name?: string;
        gstin?: string;
        address?: string;
        contact_phone?: string;
        contact_email?: string;
        authorized_signatory_name?: string;
        authorized_signatory_designation?: string;
        is_verified?: boolean;
        notes?: string;
        updated_at?: string;
    };
}

export interface Location {
    id: string;
    name: string;
    code: string;
    plant: string;
    plant_name?: string;
    type: string;
    is_system: boolean;
    is_active: boolean;
}

export interface WorkCenter {
    id: string;
    name: string;
    code: string;
    plant: string;
    plant_name: string;
    default_cost_absorption_group?: string | null;
    default_cost_absorption_group_code?: string | null;
    process_codes: string[];
    processes: string[];
}

export interface Machine {
    id: string;
    name: string;
    code: string;
    work_center: string;
    work_center_name: string;
    status: string;
    cost_absorption_group?: string | null;
    cost_absorption_group_code?: string | null;
}

export interface Process {
    id: string;
    name: string;
    code: string;
    input_form: 'BULK' | 'ROLL' | 'NONE';
    output_form: 'BULK' | 'ROLL';
    input_mode?: 'BULK' | 'ROLL' | 'NONE';
    output_mode?: 'BULK' | 'ROLL';
    roll_behavior: 'CREATE_NEW' | 'MODIFY_EXISTING' | 'MULTI_INPUT_COMBINE' | 'SPLIT' | 'NONE';
    description: string;
    is_active?: boolean;
    status?: string;
}

export interface PlantShiftDefinition {
    id: string;
    plant: string;
    plant_name?: string;
    plant_code?: string;
    code: string;
    name?: string;
    start_time: string;
    end_time: string;
    crosses_midnight: boolean;
    is_active: boolean;
    priority: number;
}

export const factoryService = {
    // Plants
    getPlants: async () => {
        const response = await api.get<MaybePaginated<Plant>>("/api/factory/plants/");
        return unwrapList<Plant>(response.data);
    },
    createPlant: async (data: {
        code: string;
        name: string;
        default_cost_absorption_group?: string | null;
        include_in_official_reports?: boolean;
        legal_profile?: {
            legal_name?: string;
            gstin?: string;
            address?: string;
            contact_phone?: string;
            contact_email?: string;
            authorized_signatory_name?: string;
            authorized_signatory_designation?: string;
        };
    }) => {
        const response = await api.post<Plant>("/api/factory/plants/", data);
        return response.data;
    },
    updatePlant: async (id: string, data: {
        code: string;
        name: string;
        default_cost_absorption_group?: string | null;
        include_in_official_reports?: boolean;
        legal_profile?: {
            legal_name?: string;
            gstin?: string;
            address?: string;
            contact_phone?: string;
            contact_email?: string;
            authorized_signatory_name?: string;
            authorized_signatory_designation?: string;
        };
    }) => {
        const response = await api.put<Plant>(`/api/factory/plants/${id}/`, data);
        return response.data;
    },
    deletePlant: async (id: string) => {
        await api.delete(`/api/factory/plants/${id}/`);
    },

    // Locations
    getLocations: async () => {
        const response = await api.get<MaybePaginated<Location>>("/api/factory/locations/");
        return unwrapList<Location>(response.data);
    },
    createLocation: async (data: { code: string; name: string; plant: string; type: string }) => {
        const response = await api.post<Location>("/api/factory/locations/", data);
        return response.data;
    },
    updateLocation: async (id: string, data: { code: string; name: string; plant: string; type: string }) => {
        const response = await api.put<Location>(`/api/factory/locations/${id}/`, data);
        return response.data;
    },
    deleteLocation: async (id: string) => {
        await api.delete(`/api/factory/locations/${id}/`);
    },

    // Work Centers
    getWorkCenters: async () => {
        const response = await api.get<MaybePaginated<WorkCenter>>("/api/factory/work-centers/");
        return unwrapList<WorkCenter>(response.data);
    },
    createWorkCenter: async (data: { code: string; name: string; plant: string; processes?: string[]; default_cost_absorption_group?: string | null }) => {
        const { processes, ...rest } = data;
        const response = await api.post<WorkCenter>("/api/factory/work-centers/", { ...rest, process_ids_input: processes });
        return response.data;
    },
    updateWorkCenter: async (id: string, data: { code: string; name: string; plant: string; processes?: string[]; default_cost_absorption_group?: string | null }) => {
        const { processes, ...rest } = data;
        const response = await api.put<WorkCenter>(`/api/factory/work-centers/${id}/`, { ...rest, process_ids_input: processes });
        return response.data;
    },
    deleteWorkCenter: async (id: string) => {
        await api.delete(`/api/factory/work-centers/${id}/`);
    },

    // Machines
    getMachines: async () => {
        const response = await api.get<MaybePaginated<Machine>>("/api/factory/machines/");
        return unwrapList<Machine>(response.data);
    },
    createMachine: async (data: { code: string; name: string; work_center: string; cost_absorption_group?: string | null }) => {
        const response = await api.post<Machine>("/api/factory/machines/", data);
        return response.data;
    },
    updateMachine: async (id: string, data: { code: string; name: string; work_center: string; cost_absorption_group?: string | null }) => {
        const response = await api.put<Machine>(`/api/factory/machines/${id}/`, data);
        return response.data;
    },
    deleteMachine: async (id: string) => {
        await api.delete(`/api/factory/machines/${id}/`);
    },

    // Processes
    getProcesses: async () => {
        const response = await api.get<MaybePaginated<Process>>("/api/factory/processes/");
        return unwrapList<Process>(response.data);
    },
    createProcess: async (data: Partial<Process>) => {
        const response = await api.post<Process>("/api/factory/processes/", data);
        return response.data;
    },
    updateProcess: async (id: string, data: Partial<Process>) => {
        const response = await api.put<Process>(`/api/factory/processes/${id}/`, data);
        return response.data;
    },
    deleteProcess: async (id: string) => {
        await api.delete(`/api/factory/processes/${id}/`);
    },

    // Shift Definitions
    getShifts: async (plantId?: string) => {
        const response = await api.get<MaybePaginated<PlantShiftDefinition>>("/api/factory/shifts/", {
            params: plantId ? { plant: plantId } : undefined,
        });
        const rows = unwrapList<PlantShiftDefinition>(response.data);
        return rows.filter((row) => row.is_active);
    },
};
