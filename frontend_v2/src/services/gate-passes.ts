import { api } from "@/lib/api";

/*
 * Gate passes: RGP (returnable) and NRGP (non-returnable) for non-stock items
 * leaving the factory. View = documents.view, changes = gatepass.manage.
 * Contract: apps/gate/gate_pass_views.py. Never moves stock.
 */

export type GatePassKind = "RETURNABLE" | "NON_RETURNABLE";
export type GatePassStatus =
  | "DRAFT"
  | "ISSUED"
  | "OUT"
  | "PARTLY_RETURNED"
  | "RETURNED"
  | "CLOSED"
  | "SHORT_CLOSED"
  | "CANCELLED";
export type GatePassTab = "OPEN" | "OVERDUE" | "DONE" | "DRAFT" | "ALL";
export type GatePassAction = "edit" | "issue" | "cancel" | "receive_back" | "short_close";

export interface GatePassLine {
  id: string;
  line_no: number;
  description: string;
  quantity: string;
  uom: string;
  machine: string | null;
  machine_name: string;
  equipment_text: string;
  serial_no: string;
  approx_value: string | null;
  returned_quantity: string;
  outstanding_quantity: string;
  remarks: string;
}

export interface GatePassReturnRow {
  id: string;
  line_id: string;
  line_no: number;
  description: string;
  quantity: string;
  uom: string;
  returned_at: string;
  received_by_name: string;
  notes: string;
  general_receipt_line_id: string | null;
  general_receipt_number: string;
  inward_document_id: string | null;
}

export interface GatePassOutwardRow {
  link_id: string;
  document_id: string;
  departed_at: string;
  vehicle_number: string;
  status: string;
  page_count: number;
  link_source: "QR" | "MANUAL";
  recorded_by_name: string;
  active: boolean;
  removed_reason: string;
  can_open: boolean;
  thumb_url: string | null;
}

export interface GatePassReceiptLine {
  id: string;
  receipt_id: string;
  receipt_number: string;
  receipt_status: string;
  received_at: string;
  gate_pass_line_id: string;
  line_no: number;
  description: string;
  quantity: string;
  uom: string;
}

export interface GatePass {
  id: string;
  number: string | null;
  display_number: string;
  kind: GatePassKind;
  kind_label: string;
  kind_short: "RGP" | "NRGP";
  plant: string;
  plant_name: string;
  vendor: string | null;
  vendor_name: string;
  party_name: string;
  party_address: string;
  party_gstin: string;
  purpose: string;
  purpose_label: string;
  expected_return_date: string | null;
  vehicle_number: string;
  carried_by: string;
  status: GatePassStatus;
  status_label: string;
  is_overdue: boolean;
  days_overdue: number;
  notes: string;
  created_by_name: string;
  created_at: string;
  issued_by_name: string;
  issued_at: string | null;
  out_at: string | null;
  closed_by_name: string;
  closed_at: string | null;
  close_reason: string;
  version: number;
  line_count: number;
  approx_value_total: string | null;
  lines: GatePassLine[];
  print_url: string;
  actions: GatePassAction[];
  replayed?: boolean;
  // detail only
  returns?: GatePassReturnRow[];
  general_receipt_lines?: GatePassReceiptLine[];
  outward_documents?: GatePassOutwardRow[];
  timeline?: Array<{ id: string; action: string; actor_name: string; reason: string; created_at: string }>;
}

export interface GatePassListPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: GatePass[];
  counts?: Record<GatePassTab, number>;
}

export interface GatePassLineInput {
  description: string;
  quantity: string;
  uom: string;
  machine?: string | null;
  equipment_text?: string;
  serial_no?: string;
  approx_value?: string | null;
  remarks?: string;
}

export interface GatePassInput {
  kind: GatePassKind;
  plant: string;
  vendor?: string | null;
  party_name?: string;
  party_address?: string;
  party_gstin?: string;
  purpose: string;
  expected_return_date?: string | null;
  vehicle_number?: string;
  carried_by?: string;
  notes?: string;
  lines: GatePassLineInput[];
}

export interface GatePassFormOptions {
  plants: Array<{ id: string; name: string; code: string }>;
  vendors: Array<{ id: string; name: string; code: string; address: string; gstin: string }>;
  machines: Array<{ id: string; name: string; code: string; status: string; work_center: string; plant: string }>;
  uoms: string[];
  kinds: Array<{ value: GatePassKind; label: string }>;
  purposes: Array<{ value: string; label: string }>;
}

/** GET open-lines contract (General Receipt RGP return picker, workstream B). */
export interface GatePassOpenLine {
  line_id: string;
  gate_pass_id: string;
  gate_pass_number: string;
  line_no: number;
  description: string;
  uom: string;
  outstanding_quantity: string;
  machine_name: string;
  expected_return_date: string | null;
  quantity?: string;
  returned_quantity?: string;
  machine_id?: string | null;
  equipment_text?: string;
  serial_no?: string;
  party_name?: string;
  vendor_id?: string | null;
  plant?: string;
  plant_name?: string;
}

function clean(params: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

export const gatePassesApi = {
  list: async (params: { status?: GatePassTab | GatePassStatus; kind?: GatePassKind; plant?: string; vendor?: string; machine?: string; search?: string; page?: number; page_size?: number }) => {
    const { data } = await api.get<GatePassListPage>("/api/gate/gate-passes/", { params: clean(params) });
    return { ...data, results: Array.isArray(data?.results) ? data.results : [] } as GatePassListPage;
  },
  get: async (id: string) => (await api.get<GatePass>(`/api/gate/gate-passes/${id}/`)).data,
  create: async (payload: GatePassInput & { client_token: string }) => (await api.post<GatePass>("/api/gate/gate-passes/", payload)).data,
  update: async (id: string, payload: GatePassInput & { client_token: string; version: number }) =>
    (await api.patch<GatePass>(`/api/gate/gate-passes/${id}/`, payload)).data,
  issue: async (id: string, payload: { client_token: string; version?: number }) =>
    (await api.post<GatePass>(`/api/gate/gate-passes/${id}/issue/`, payload)).data,
  cancel: async (id: string, payload: { client_token: string; reason: string }) =>
    (await api.post<GatePass>(`/api/gate/gate-passes/${id}/cancel/`, payload)).data,
  shortClose: async (id: string, payload: { client_token: string; reason: string }) =>
    (await api.post<GatePass>(`/api/gate/gate-passes/${id}/short-close/`, payload)).data,
  receiveBack: async (id: string, payload: { client_token: string; reason: string; lines: Array<{ line_id: string; quantity: string }> }) =>
    (await api.post<GatePass>(`/api/gate/gate-passes/${id}/receive-back/`, payload)).data,
  openLines: async (params: { vendor?: string; party?: string; plant?: string }) =>
    (await api.get<GatePassOpenLine[]>("/api/gate/gate-passes/open-lines/", { params: clean(params) })).data ?? [],
  formOptions: async (params: { plant?: string; q?: string }) =>
    (await api.get<GatePassFormOptions>("/api/gate/gate-passes/form-options/", { params: clean(params) })).data,
  /** Authenticated PDF → object URL (caller revokes). */
  printObjectUrl: async (id: string) => {
    const { data } = await api.get<Blob>(`/api/gate/gate-passes/${id}/print.pdf`, { responseType: "blob", timeout: 60_000 });
    return URL.createObjectURL(data);
  },
};

export const GATE_PASS_STATUS_META: Record<GatePassStatus, { label: string; tone: "warn" | "info" | "good" | "neutral" | "bad" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ISSUED: { label: "Issued · waiting at gate", tone: "info" },
  OUT: { label: "Out of factory", tone: "warn" },
  PARTLY_RETURNED: { label: "Partly returned", tone: "info" },
  RETURNED: { label: "Returned", tone: "good" },
  CLOSED: { label: "Closed", tone: "good" },
  SHORT_CLOSED: { label: "Short-closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const GATE_PASS_TABS: Array<{ key: GatePassTab; label: string; hint: string }> = [
  { key: "OPEN", label: "Open", hint: "Issued, out of the factory or partly returned" },
  { key: "OVERDUE", label: "Overdue", hint: "Returnable items past their expected return date" },
  { key: "DONE", label: "Returned / closed", hint: "Returned, closed, short-closed or cancelled" },
  { key: "DRAFT", label: "Drafts", hint: "Not issued yet — cannot leave the gate" },
  { key: "ALL", label: "All", hint: "Every gate pass" },
];

export const GATE_PASS_DEFAULT_PURPOSE: Record<GatePassKind, string> = { RETURNABLE: "REPAIR", NON_RETURNABLE: "SCRAP_SALE" };
