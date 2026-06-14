import { api } from "@/lib/api";

const INK_CONTROL_API = "/api/production/ink-control";

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
  code: string;
  name: string;
}

export interface Location {
  id: string;
  plant: string;
  plant_name?: string;
  code: string;
  name: string;
  type: string;
  is_active?: boolean;
}

export interface InkMaterial {
  id: string;
  code: string;
  name: string;
  status?: string;
  category?: string;
  base_type?: "POLY" | "PET" | string;
  color_name?: string;
  swatch_hex?: string;
  is_mix?: boolean;
  mix_family?: string;
  mix_notes?: string;
}

export interface FloorBulkStock {
  id: string;
  material: string;
  material_name: string;
  material_code: string;
  material_category: string;
  plant: string;
  plant_name: string;
  location: string;
  location_name: string;
  qty_kg: number;
  quantity?: number;
  uom?: string;
  stock_uom?: string;
  base_uom?: string;
  avg_cost?: number;
  updated_at?: string;
}

export interface CurrentShift {
  shift_code: string;
  started_at: string | null;
  ends_at: string | null;
}

export interface InkFloorMovement {
  id: string;
  type: "ISSUE" | "RETURN" | "MIX_RETURN" | "COUNT_ADJUST";
  plant: string;
  plant_name?: string;
  material: string;
  material_code?: string;
  material_name?: string;
  target_material?: string | null;
  target_material_code?: string | null;
  target_material_name?: string | null;
  source_location?: string | null;
  source_location_name?: string | null;
  destination_location?: string | null;
  destination_location_name?: string | null;
  qty_kg: string | number;
  event_at: string;
  shift_code?: string;
  shift_date?: string | null;
  reference?: string;
  notes?: string;
}

export interface InkFloorCountLine {
  id: string;
  material: string;
  material_code?: string;
  material_name?: string;
  system_qty_kg: string | number;
  counted_qty_kg: string | number;
  variance_qty_kg: string | number;
}

export interface InkFloorSession {
  id: string;
  plant: string;
  plant_name?: string;
  location: string;
  location_name?: string;
  status: "OPEN" | "POSTED" | "LOCKED" | "VOID";
  shift_code?: string;
  shift_date?: string | null;
  opened_at: string;
  counted_at?: string | null;
  closed_at?: string | null;
  reference?: string;
  notes?: string;
  count_lines?: InkFloorCountLine[];
}

export interface InkReconciliation {
  totals: {
    opening_kg: number;
    issued_kg: number;
    returned_kg: number;
    closing_kg: number;
    actual_consumed_kg: number;
    theory_ink_kg: number;
    variance_kg: number;
    variance_pct: number | null;
  };
  lines: Array<{
    material_id: string;
    material_code: string;
    material_name: string;
    opening_kg: number;
    issued_kg: number;
    returned_kg: number;
    closing_kg: number;
    actual_consumed_kg: number;
  }>;
  allocations: Array<{
    job_number: string;
    job_id?: string;
    sales_order?: string;
    sales_order_item_id?: string;
    theory_ink_kg: number;
    actual_allocated_kg: number;
    variance_kg: number;
    variance_pct: number | null;
  }>;
}

export const inkControlService = {
  getPlants: async () => {
    const { data } = await api.get<MaybePaginated<Plant>>("/api/factory/plants/");
    return unwrapList<Plant>(data);
  },
  getLocations: async (plantId?: string) => {
    const endpoint = plantId ? `/api/inventory/plants/${plantId}/locations/` : "/api/inventory/locations/";
    const { data } = await api.get<MaybePaginated<Location>>(endpoint);
    return unwrapList<Location>(data);
  },
  getInks: async () => {
    const { data } = await api.get<MaybePaginated<InkMaterial>>("/api/master/inks/");
    return unwrapList<InkMaterial>(data);
  },
  getFloorStock: async (params?: Record<string, string | undefined>) => {
    const { data } = await api.get<MaybePaginated<FloorBulkStock>>("/api/inventory/bulk/", { params });
    return unwrapList<FloorBulkStock>(data);
  },
  getCurrentShift: async (at?: string) => {
    const { data } = await api.get<CurrentShift>("/api/production/current-shift/", {
      params: at ? { at } : undefined,
    });
    return data;
  },
  getMovements: async (params?: Record<string, string | undefined>) => {
    const { data } = await api.get<MaybePaginated<InkFloorMovement>>(`${INK_CONTROL_API}/movements/`, {
      params,
    });
    return unwrapList<InkFloorMovement>(data);
  },
  getSessions: async (params?: Record<string, string | undefined>) => {
    const { data } = await api.get<MaybePaginated<InkFloorSession>>(`${INK_CONTROL_API}/sessions/`, {
      params,
    });
    return unwrapList<InkFloorSession>(data);
  },
  issue: async (payload: {
    material_id: string;
    qty_kg: number | string;
    from_location_id: string;
    floor_location_id: string;
    event_at?: string;
    reference?: string;
    notes?: string;
  }) => {
    const { data } = await api.post<InkFloorMovement>(`${INK_CONTROL_API}/issue/`, payload);
    return data;
  },
  returnInk: async (payload: {
    material_id: string;
    qty_kg: number | string;
    floor_location_id: string;
    to_location_id: string;
    event_at?: string;
    reference?: string;
    notes?: string;
  }) => {
    const { data } = await api.post<InkFloorMovement>(`${INK_CONTROL_API}/return/`, payload);
    return data;
  },
  mixReturn: async (payload: {
    source_material_id: string;
    qty_kg: number | string;
    floor_location_id: string;
    to_location_id: string;
    target_material_id?: string;
    target_base_type?: "POLY" | "PET" | string;
    target_color_name?: string;
    event_at?: string;
    reference?: string;
    notes?: string;
  }) => {
    const { data } = await api.post<InkFloorMovement>(`${INK_CONTROL_API}/mix-return/`, payload);
    return data;
  },
  postCount: async (payload: {
    plant_id: string;
    location_id: string;
    counted_at?: string;
    opened_at?: string;
    reference?: string;
    notes?: string;
    lines: Array<{ material_id: string; counted_qty_kg: number | string }>;
  }) => {
    const { data } = await api.post<InkFloorSession>(`${INK_CONTROL_API}/count/`, payload);
    return data;
  },
  reconcile: async (params: {
    plant: string;
    location: string;
    start_at?: string;
    end_at?: string;
  }) => {
    const { data } = await api.get<InkReconciliation>(`${INK_CONTROL_API}/reconcile/`, { params });
    return data;
  },
};
