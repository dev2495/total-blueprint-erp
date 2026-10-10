import { api, getApiErrorStatus } from "@/lib/api";

/*
 * General Receipts: "received / done by whom, when" for spares, machinery,
 * tools, consumables, services and charges. Never posts stock.
 * Contract: apps/procurement/general_receipt_views.py (docs/documents-jobwork/SPEC.md §2-B).
 */

export type ReceiptType = "GOODS" | "SERVICE";
export type LineCategory = "SPARES" | "MACHINERY" | "TOOLS" | "CONSUMABLE" | "SAFETY" | "ELECTRICAL" | "CIVIL" | "OFFICE" | "SERVICE" | "CHARGE";
export type Disposition = "KEPT_IN_STORE" | "INSTALLED" | "CONSUMED" | "NOT_APPLICABLE";

export interface GeneralReceiptLine {
  id: string;
  line_no: number;
  line_category: LineCategory;
  line_category_label: string;
  description: string;
  quantity: string;
  uom: string;
  rate: string | null;
  amount: string | null;
  gst_rate: string | null;
  gst_amount: string | null;
  disposition: Disposition;
  disposition_label: string;
  machine: { id: string; name: string; code: string; plant_name: string } | null;
  equipment_text: string;
  serial_no: string;
  remarks: string;
  gate_pass_line: { id: string; gate_pass_id: string; gate_pass_number: string; line_no: number; description: string } | null;
  returned_quantity: string | null;
}

export interface GeneralReceipt {
  id: string;
  number: string;
  plant: string;
  plant_name: string;
  document: { id: string; ref: string; status: string; category: string; party_display: string; invoice_number: string; followup: boolean } | null;
  vendor: string | null;
  vendor_name: string | null;
  vendor_code: string | null;
  party_name: string;
  invoice_number: string;
  invoice_date: string | null;
  receipt_type: ReceiptType;
  receipt_type_label: string;
  received_at: string;
  received_by: string;
  received_by_name: string | null;
  reference: string;
  notes: string;
  status: "POSTED" | "REVERSED";
  reversed_at: string | null;
  reversed_by_name: string | null;
  reversal_reason: string;
  created_by_name: string | null;
  created_at: string;
  line_count: number;
  amount: string;
  gst_amount: string;
  total_with_gst: string;
  machines: string[];
  lines: GeneralReceiptLine[];
  has_gate_pass_returns: boolean;
  can_reverse: boolean;
  replayed?: boolean;
}

export interface GeneralReceiptLineInput {
  line_category: LineCategory;
  description: string;
  quantity: string;
  uom: string;
  rate?: string | null;
  amount?: string | null;
  gst_rate?: string | null;
  disposition: Disposition;
  machine?: string | null;
  equipment_text?: string;
  serial_no?: string;
  remarks?: string;
  gate_pass_line?: string | null;
  returned_quantity?: string | null;
}

export interface GeneralReceiptInput {
  client_token: string;
  plant: string;
  document?: string | null;
  followup_of_bill?: string | null;
  bill_complete?: boolean;
  vendor?: string | null;
  party_name?: string;
  invoice_number?: string;
  invoice_date?: string | null;
  receipt_type: ReceiptType;
  received_at: string;
  received_by?: string | null;
  reference?: string;
  notes?: string;
  duplicate_override_reason?: string;
  lines: GeneralReceiptLineInput[];
}

export interface ReceiptOptions {
  plants: Array<{ id: string; name: string; code: string }>;
  machines: Array<{ id: string; name: string; code: string; status: string; plant: string; plant_name: string; work_center_name: string }>;
  receivers: Array<{ id: string; name: string; username: string }>;
  receipt_types: Array<{ code: ReceiptType; label: string }>;
  line_categories: Array<{ code: LineCategory; label: string }>;
  dispositions: Array<{ code: Disposition; label: string }>;
  uoms: string[];
  gst_rates: string[];
}

export interface DescriptionSuggestion {
  description: string;
  line_category: LineCategory;
  uom: string;
  last_rate: string | null;
  last_gst_rate: string | null;
  last_received_at: string;
  vendor: string | null;
  vendor_name: string;
  number: string;
}

export type MachineEvent =
  | {
      kind: "GENERAL_RECEIPT";
      at: string;
      receipt_id: string;
      number: string;
      receipt_type: ReceiptType;
      status: "POSTED" | "REVERSED";
      line_category: LineCategory;
      line_category_label: string;
      description: string;
      quantity: string;
      uom: string;
      rate: string | null;
      amount: string | null;
      disposition: Disposition;
      disposition_label: string;
      serial_no: string;
      party: string;
      invoice_number: string;
      plant_name: string;
    }
  | {
      kind: "GATE_PASS_OUT";
      at: string;
      gate_pass_id: string;
      number: string;
      gate_pass_kind: string;
      purpose: string;
      status: string;
      description: string;
      quantity: string;
      uom: string;
      returned_quantity: string;
      party: string;
      expected_return_date: string | null;
    }
  | {
      kind: "GATE_PASS_RETURN";
      at: string;
      gate_pass_id: string;
      number: string;
      description: string;
      quantity: string;
      uom: string;
      party: string;
      general_receipt_line_id: string | null;
    };

export interface MachineHistory {
  machine: { id: string; name: string; code: string; status: string; plant: string; plant_name: string };
  totals: { amount: string; lines: number; service_lines: number };
  events: MachineEvent[];
}

/** Workstream D: outstanding returnable gate pass lines (RGP) for the return picker. */
export interface OpenGatePassLine {
  line_id: string;
  gate_pass_id: string;
  gate_pass_number: string;
  line_no: number;
  description: string;
  uom: string;
  outstanding_quantity: string;
  machine_name: string;
  expected_return_date: string | null;
}

export interface ReceiptFilters {
  plant?: string;
  vendor?: string;
  receipt_type?: ReceiptType | "";
  line_category?: LineCategory | "";
  machine?: string;
  status?: "POSTED" | "REVERSED" | "";
  date_from?: string;
  date_to?: string;
  search?: string;
  document?: string;
}

export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

function clean(params: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

export const generalReceiptsApi = {
  list: async (params: ReceiptFilters & { page?: number; page_size?: number }) => {
    const { data } = await api.get<Page<GeneralReceipt>>("/api/procurement/general-receipts/", { params: clean(params as Record<string, unknown>) });
    return { count: Number(data?.count ?? 0), next: data?.next ?? null, previous: data?.previous ?? null, results: Array.isArray(data?.results) ? data.results : [] };
  },
  get: async (id: string) => (await api.get<GeneralReceipt>(`/api/procurement/general-receipts/${id}/`)).data,
  create: async (payload: GeneralReceiptInput) => (await api.post<GeneralReceipt>("/api/procurement/general-receipts/", payload, { timeout: 60_000 })).data,
  reverse: async (id: string, payload: { client_token: string; reason: string }) =>
    (await api.post<GeneralReceipt>(`/api/procurement/general-receipts/${id}/reverse/`, payload)).data,
  options: async (plants: string[] = []) => {
    const params = new URLSearchParams();
    plants.filter(Boolean).forEach((plant) => params.append("plant", plant));
    return (await api.get<ReceiptOptions>(`/api/procurement/general-receipts/options/${params.toString() ? `?${params}` : ""}`)).data;
  },
  machineHistory: async (machine: string) =>
    (await api.get<MachineHistory>("/api/procurement/general-receipts/machine-history/", { params: { machine } })).data,
  suggestions: async (params: { q?: string; vendor?: string }) =>
    (await api.get<{ results: DescriptionSuggestion[] }>("/api/procurement/general-receipts/suggestions/", { params: clean(params) })).data?.results ?? [],
  /**
   * Open RGP lines (workstream D). Resolves `null` when the endpoint is not
   * deployed yet (404/405) so the form can explain instead of failing.
   */
  openGatePassLines: async (params: { vendor?: string; party?: string; plant?: string }): Promise<OpenGatePassLine[] | null> => {
    try {
      const { data } = await api.get<OpenGatePassLine[] | { results: OpenGatePassLine[] }>("/api/gate/gate-passes/open-lines/", { params: clean(params) });
      return Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
    } catch (error) {
      const status = getApiErrorStatus(error);
      if (status === 404 || status === 405) return null;
      throw error;
    }
  },
};

export const LINE_CATEGORY_LABEL: Record<LineCategory, string> = {
  SPARES: "Spares and parts",
  MACHINERY: "Machinery / equipment",
  TOOLS: "Tools",
  CONSUMABLE: "General consumable",
  SAFETY: "Safety items",
  ELECTRICAL: "Electrical",
  CIVIL: "Civil / building",
  OFFICE: "Office / admin",
  SERVICE: "Service / labour",
  CHARGE: "Freight / other charge",
};

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  KEPT_IN_STORE: "Kept in store",
  INSTALLED: "Installed / fitted",
  CONSUMED: "Used immediately",
  NOT_APPLICABLE: "Not applicable",
};

export const GENERAL_UOMS = ["NOS", "PCS", "SET", "PAIR", "KG", "LTR", "MTR", "BOX", "ROLL", "JOB", "HRS", "VISIT", "LOT"];
export const GST_RATES = ["0", "5", "12", "18", "28", "40"];
