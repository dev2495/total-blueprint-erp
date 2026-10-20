import { api } from "@/lib/api";

export type MovementStage = "PREPARED" | "OUTSIDE" | "AT_GATE" | "DONE";
export type MovementKind = "INTERPLANT" | "JOBWORK" | "RGP" | "NRGP";
export type ArrivalKind = "INTERPLANT_DC" | "JOBWORK_CHALLAN" | "GATE_PASS";

export interface MovementRow {
  kind: MovementKind;
  id: string;
  number: string;
  party: string;
  plant: string;
  plant_name: string;
  to_plant_name: string;
  status: string;
  status_label: string;
  stage: MovementStage;
  summary: string;
  job_number: string;
  auto: boolean;
  created_at: string | null;
  left_at: string | null;
  left_at_gate: boolean;
  expected_back: string | null;
  back_at_gate_at: string | null;
  done_at: string | null;
  vehicle: string;
  overdue: boolean;
  late_note: string;
  link: string;
  returns?: number;
  arrival: { kind: ArrivalKind; object_id: string; plant: string } | null;
}

export interface MovementRegister {
  counts: Record<MovementStage, number>;
  open_by_kind: Record<MovementKind, number>;
  overdue: number;
  kinds: Record<MovementKind, string>;
  total: number;
  page: number;
  page_size: number;
  results: MovementRow[];
  done_window_days: number;
}

export interface ArrivalPreview {
  kind: ArrivalKind;
  kind_label: string;
  id: string;
  reference: string;
  party_name: string;
  summary: string;
  status: string;
  warnings: string[];
  lines?: Array<{ description: string; quantity: string | number; uom: string }>;
}

export interface GateArrival {
  id: string;
  kind: ArrivalKind;
  kind_label: string;
  object_id: string;
  reference: string;
  party_name: string;
  summary: string;
  plant: string;
  plant_name: string;
  vehicle_number: string;
  notes: string;
  arrived_at: string | null;
  recorded_by: string;
  link: string;
}

export const goodsMovementsApi = {
  register: async (params: { stage?: MovementStage | ""; kind?: MovementKind | ""; plant?: string; q?: string; overdue?: boolean; page?: number; page_size?: number }) => {
    const { data } = await api.get<MovementRegister>("/api/inventory/goods-movements/", {
      params: {
        stage: params.stage || undefined,
        kind: params.kind || undefined,
        plant: params.plant || undefined,
        q: params.q || undefined,
        overdue: params.overdue ? 1 : undefined,
        page: params.page || 1,
        page_size: params.page_size || 50,
      },
    });
    return data;
  },
  previewArrival: async (params: { plant: string; code?: string; kind?: ArrivalKind; object_id?: string }) =>
    (await api.get<ArrivalPreview>("/api/gate/arrivals/preview/", { params, timeout: 15_000 })).data,
  recordArrival: async (payload: { plant: string; code?: string; kind?: ArrivalKind; object_id?: string; vehicle_number?: string; notes?: string; client_token: string }) =>
    (await api.post<{ arrival: GateArrival; replayed: boolean }>("/api/gate/arrivals/", payload)).data,
  arrivals: async (plant?: string) =>
    (await api.get<{ results: GateArrival[] }>("/api/gate/arrivals/", { params: { plant: plant || undefined } })).data.results,
};
