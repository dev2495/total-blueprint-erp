import { api } from "@/lib/api";

/*
 * Job work (outside processing) — /api/inventory/job-work/.
 * Orders (JWO) → dispatch with a Rule 45 challan (JWC) → returns (JWR) that
 * settle every sent roll → close / short-close. Every write carries a frozen
 * client_token: a retry with the same token replays, a changed payload is 409.
 */

export type JobWorkStatus = "DRAFT" | "SENT" | "PARTLY_RETURNED" | "RETURNED" | "CLOSED" | "CANCELLED";
export type JobWorkMode = "PLANNED_STEP" | "EMERGENCY";
export type JobWorkOutputKind = "FG_PCS" | "ROLLS" | "BULK";
export type JobWorkUom = "PCS" | "KG" | "METER" | "ROLL";
export type JobWorkTab = "OPEN" | "AT_VENDOR" | "OVERDUE" | "CLOSED";
export type SentDisposition = "PROCESSED" | "RETURNED" | "PARTLY_USED";

export interface JobWorkRate {
  process_code: string;
  rate: string;
  uom: JobWorkUom;
}

export interface JobWorkOrderRow {
  id: string;
  number: string;
  status: JobWorkStatus;
  status_label: string;
  mode: JobWorkMode;
  plant: string;
  plant_name: string;
  vendor: string | null;
  vendor_name: string;
  production_job: string | null;
  production_job_number: string | null;
  process_code: string | null;
  process_name: string | null;
  expected_output_kind: JobWorkOutputKind;
  expected_output_label: string;
  expected_qty: string | null;
  expected_uom: string;
  rate: string | null;
  rate_uom: string;
  expected_return_date: string | null;
  dispatched_at: string | null;
  created_at: string;
  closed_at: string | null;
  sent_kg: string | null;
  at_vendor_kg: string;
  open_lines: number;
  oldest_open_days: number | null;
  overdue: boolean;
  itc04_alert: boolean;
  is_legacy: boolean;
}

export interface JobWorkSentLine {
  id: string;
  challan_id: string | null;
  challan_number: string | null;
  line_no: number;
  kind: "ROLL" | "BULK";
  is_legacy: boolean;
  roll_id: string | null;
  roll_label: string;
  roll_status: string | null;
  material_id: string | null;
  material_name: string;
  description: string;
  hsn_code: string;
  quantity: string;
  uom: string;
  qty_kg: string;
  width_mm: string | null;
  thickness_micron: string | null;
  value: string;
  sent_at: string;
  age_days: number | null;
  open_qty: string;
  open_kg: string;
  is_open: boolean;
  consumed_kg: string;
  returned_kg: string;
  itc04_alert: boolean;
  itc04_overdue: boolean;
}

export interface JobWorkChallan {
  id: string;
  number: string;
  issued_at: string;
  issued_by_name: string | null;
  purpose: string;
  expected_return_date: string | null;
  place_of_supply: string;
  vehicle_no: string;
  notes: string;
  total_qty_kg: string;
  total_value: string;
  line_count: number;
  gate_out_at: string | null;
  gate_out_by_name: string | null;
  pdf_url: string;
  lines: JobWorkSentLine[];
}

export interface JobWorkReturnLine {
  id: string;
  line_no: number;
  kind: "FG_PCS" | "OUTPUT_ROLL" | "OUTPUT_BULK" | "BALANCE_ROLL" | "BALANCE_BULK" | "WASTAGE";
  quantity: string;
  uom: string;
  qty_kg: string;
  boxes: number | null;
  bags: number | null;
  returned_to_factory: boolean | null;
  location_name: string | null;
  sent_line_id: string | null;
  material_name: string | null;
  roll_id: string | null;
  roll_label: string | null;
  fg_batch_id: string | null;
  fg_batch_number: string | null;
  scrap_log_id: string | null;
  meta: Record<string, unknown>;
}

export interface JobWorkWarning {
  code: string;
  message: string;
}

export interface JobWorkReturnDoc {
  id: string;
  number: string;
  received_at: string;
  received_by_name: string | null;
  vendor_document_no: string;
  vendor_document_date: string | null;
  bill: { id: string; status: string } | null;
  settled_sent_kg: string;
  output_kg: string;
  output_pcs: number;
  balance_kg: string;
  wastage_kg: string;
  variance_kg: string;
  variance_pct: string | null;
  variance_reason: string;
  billed_qty: string | null;
  billed_uom: string;
  billed_rate: string | null;
  billed_amount: string | null;
  warnings: JobWorkWarning[];
  notes: string;
  lines: JobWorkReturnLine[];
}

export interface JobWorkTimelineEvent {
  at: string;
  action: string;
  label: string;
  actor_name: string | null;
  reason: string;
  details: Record<string, unknown>;
}

export interface JobWorkOrderDetail {
  id: string;
  number: string;
  status: JobWorkStatus;
  status_label: string;
  mode: JobWorkMode;
  plant: string;
  plant_name: string;
  vendor: { id: string; name: string; code: string; gst_no: string; state: string; jobwork_rates: JobWorkRate[] } | null;
  vendor_name: string;
  production_job: {
    id: string;
    job_number: string;
    job_state: string;
    is_on_hold: boolean;
    hold_reason: string | null;
    uom: string;
    quantity: string | null;
    produced_qty: string | null;
    sales_order_number: string | null;
    unit_weight_g: string | null;
    inner_pack_enabled: boolean;
    has_template: boolean;
  } | null;
  process: { id: string; code: string; name: string } | null;
  route_step_index: number | null;
  emergency_reason: string;
  notes: string;
  expected_output_kind: JobWorkOutputKind;
  expected_output_label: string;
  expected_qty: string | null;
  expected_uom: string;
  rate: string | null;
  rate_uom: string;
  vendor_rate: JobWorkRate | null;
  wastage_tolerance_pct: string;
  expected_return_date: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  short_close_reason: string;
  cancel_reason: string;
  created_at: string;
  created_by_name: string | null;
  is_legacy: boolean;
  overdue: boolean;
  at_vendor: {
    kg: string;
    lines: number;
    rolls: number;
    value: string;
    oldest_sent_at: string | null;
    oldest_days: number | null;
    itc04_alert: boolean;
  };
  totals: {
    sent_kg: string;
    at_vendor_kg: string;
    open_lines: number;
    settled_kg: string;
    output_kg: string;
    output_pcs: number;
    balance_kg: string;
    wastage_kg: string;
    variance_kg: string;
    variance_pct: string | null;
    written_off_kg: string;
    tolerance_pct: string;
    variance_reason_recorded: boolean;
  };
  sent_lines: JobWorkSentLine[];
  challans: JobWorkChallan[];
  returns: JobWorkReturnDoc[];
  timeline: JobWorkTimelineEvent[];
  legacy: { stuck_rolls: number; stuck_kg: string };
  permissions: { can_manage: boolean; can_link_bill: boolean; can_reconcile: boolean };
  actions: { can_dispatch: boolean; can_receive: boolean; can_close: boolean; can_short_close: boolean; can_cancel: boolean };
}

export interface JobWorkActionResult {
  order: JobWorkOrderDetail;
  replayed?: boolean;
  challan_id?: string;
  challan_number?: string;
  return_id?: string;
  return_number?: string;
  warnings?: JobWorkWarning[];
  bill?: { id: string; status: string; resolved_at: string | null } | null;
  step?: { job_number: string; action: string; detail: string } | null;
  written_off?: Array<{ line: string; qty: string; uom: string; kg: string }>;
}

export interface JobWorkListPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: JobWorkOrderRow[];
  tab_counts: Record<JobWorkTab, number>;
}

export interface JobWorkVendorCandidate {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  gst_no: string;
  state: string;
  turnaround_hours: number;
  qc_required: boolean;
  jobwork_capabilities: string[];
  jobwork_plants: string[];
  jobwork_rates: JobWorkRate[];
  process_rates: JobWorkRate[];
  vendor_capability_match: boolean;
  match_reasons: string[];
}

export interface JobWorkEligibleRoll {
  id: string;
  label_id: string;
  material_name: string | null;
  status: string;
  weight_kg: string;
  width_mm: string | null;
  thickness_micron: string | null;
  location_name: string;
  production_job_number: string | null;
  linked_to_order_job: boolean;
  rate_per_kg: string | null;
  suggested_value: string | null;
  reserved_for_job: string | null;
  blocked_reason: string | null;
}

export interface JobWorkEligibleBulk {
  material_id: string;
  material_name: string;
  category: string;
  uom: string;
  location_id: string;
  location_name: string;
  granule_code_id: string | null;
  granule_code: string | null;
  quantity: string;
  rate: string | null;
}

export interface JobWorkCreatePayload {
  client_token: string;
  plant?: string | null;
  vendor: string;
  production_job?: string | null;
  process?: string | null;
  mode: JobWorkMode;
  emergency_reason?: string;
  notes?: string;
  expected_output_kind: JobWorkOutputKind;
  expected_qty?: string | null;
  expected_uom?: JobWorkUom | "";
  rate?: string | null;
  rate_uom?: JobWorkUom | "";
  wastage_tolerance_pct?: string | null;
  expected_return_date?: string | null;
  save_rate_to_vendor?: boolean;
}

export interface JobWorkDispatchPayload {
  client_token: string;
  rolls: Array<{ roll_id: string; value?: string | null; hsn_code?: string }>;
  bulk_items: Array<{ material_id: string; location_id: string; quantity: string; granule_code_id?: string | null; value?: string | null; hsn_code?: string }>;
  hsn_code: string;
  purpose?: string;
  expected_return_date?: string | null;
  vehicle_no?: string;
  notes?: string;
}

export interface JobWorkReturnPayload {
  client_token: string;
  received_at?: string | null;
  vendor_document_no?: string;
  vendor_document_date?: string | null;
  sent_lines: Array<{ sent_line_id: string; disposition: SentDisposition; returned_qty?: string | null; consumed_qty?: string | null; location_id?: string | null }>;
  fg?: { qty_pcs: number; boxes?: number | null; qty_kg?: string | null; location_id: string; inner_pack_source?: "FACTORY" | "VENDOR" } | null;
  output_rolls: Array<{ material_id: string; weight_kg: string; width_mm: string; thickness_micron: string; grade_id?: string | null; label_id?: string; location_id: string }>;
  output_bulk: Array<{ material_id: string; quantity: string; location_id: string }>;
  wastage?: { kg: string; bags?: number | null; returned_to_factory: boolean; notes?: string } | null;
  variance_reason?: string;
  bill?: { bill_id: string; billed_qty?: string | null; billed_uom?: JobWorkUom | ""; billed_rate?: string | null; billed_amount?: string | null; complete: boolean } | null;
  notes?: string;
}

export interface JobWorkAgeingRow {
  vendor: string | null;
  vendor_name: string;
  kg: string;
  value: string;
  lines: number;
  orders: string[];
  oldest_days: number;
  buckets: Record<string, string>;
  itc04_alert_kg: string;
  itc04_overdue_kg: string;
  items: Array<{
    order_id: string | null;
    order_number: string | null;
    challan_number: string | null;
    plant_name: string;
    description: string;
    open_qty: string;
    uom: string;
    open_kg: string;
    value: string | null;
    sent_at: string;
    age_days: number;
    legacy?: boolean;
  }>;
}

export interface JobWorkAgeingReport {
  generated_at: string;
  buckets: Array<{ key: string; label: string }>;
  rows: JobWorkAgeingRow[];
  totals: { kg: string; value: string; lines: number; buckets: Record<string, string> };
}

export interface JobWorkYieldRow {
  vendor: string | null;
  vendor_name: string;
  returns: number;
  orders: number;
  settled_kg: string;
  processed_kg: string;
  output_kg: string;
  output_pcs: number;
  balance_kg: string;
  wastage_kg: string;
  variance_kg: string;
  yield_pct: string | null;
  wastage_pct: string | null;
  variance_pct: string | null;
}

export interface JobWorkLegacyRow {
  order: {
    id: string;
    number: string;
    status: string;
    vendor_name: string;
    plant: string;
    plant_name: string;
    production_job_number: string | null;
    dispatched_at: string | null;
    received_at: string | null;
  } | null;
  rolls: Array<{
    id: string;
    label_id: string;
    material_name: string | null;
    weight_kg: string;
    width_mm: string | null;
    thickness_micron: string | null;
    plant: string;
    plant_name: string;
    sent_at: string;
    age_days: number;
    production_job_number: string | null;
  }>;
  output_candidates: Array<{ id: string; label_id: string; material_name: string | null; weight_kg: string; status: string; created_at: string }>;
  stuck_kg: string;
}

function clean(params: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

const BASE = "/api/inventory/job-work";

/** A production job a job-work order can be raised for (served by the job-work API, inventory.view). */
export interface JobWorkEligibleJob {
  id: string;
  job_number: string;
  job_state: string;
  process_code: string;
  process_name: string;
  product_name: string;
  template_name: string;
  customer_name: string;
  order_number: string;
  quantity: string;
  uom: string;
  work_center_name: string;
  plant: string | null;
  plant_name: string;
}

export const jobWorkApi = {
  eligibleJobs: async () => (await api.get<{ results: JobWorkEligibleJob[] }>(`${BASE}/eligible-jobs/`)).data.results,
  list: async (params: { tab?: JobWorkTab; plant?: string; vendor?: string; search?: string; page?: number; page_size?: number }) => {
    const { data } = await api.get<JobWorkListPage>(`${BASE}/`, { params: clean(params) });
    return data;
  },
  get: async (id: string) => (await api.get<JobWorkOrderDetail>(`${BASE}/${id}/`)).data,
  create: async (payload: JobWorkCreatePayload) => (await api.post<JobWorkActionResult>(`${BASE}/`, payload)).data,
  dispatch: async (id: string, payload: JobWorkDispatchPayload) => (await api.post<JobWorkActionResult>(`${BASE}/${id}/dispatch/`, payload)).data,
  receive: async (id: string, payload: JobWorkReturnPayload) => (await api.post<JobWorkActionResult>(`${BASE}/${id}/returns/`, payload, { timeout: 120_000 })).data,
  close: async (id: string, payload: { client_token: string; variance_reason?: string; step_force_reason?: string }) =>
    (await api.post<JobWorkActionResult>(`${BASE}/${id}/close/`, payload)).data,
  shortClose: async (id: string, payload: { client_token: string; reason: string; step_force_reason?: string }) =>
    (await api.post<JobWorkActionResult>(`${BASE}/${id}/short-close/`, payload)).data,
  cancel: async (id: string, payload: { client_token: string; reason: string }) => (await api.post<JobWorkActionResult>(`${BASE}/${id}/cancel/`, payload)).data,
  eligibleRolls: async (id: string, params: { search?: string; scope?: "job" | "plant" }) =>
    (await api.get<{ results: JobWorkEligibleRoll[]; scope: string }>(`${BASE}/${id}/eligible-rolls/`, { params: clean(params) })).data,
  eligibleBulk: async (id: string) => (await api.get<{ results: JobWorkEligibleBulk[] }>(`${BASE}/${id}/eligible-bulk/`)).data.results,
  vendorCandidates: async (params: { production_job_id?: string; plant_id?: string; process_code?: string }) =>
    (await api.get<{ results: JobWorkVendorCandidate[]; process_code: string | null }>(`${BASE}/vendor-candidates/`, { params: clean(params) })).data,
  openOrders: async (params: { vendor?: string; bill?: string; plant?: string }) =>
    (await api.get<{ results: JobWorkOrderRow[]; count: number }>(`${BASE}/open-orders/`, { params: clean(params) })).data.results,
  reportAtVendor: async (params: { plant?: string; vendor?: string }) => (await api.get<JobWorkAgeingReport>(`${BASE}/reports/at-vendor/`, { params: clean(params) })).data,
  reportYield: async (params: { plant?: string; vendor?: string; date_from?: string; date_to?: string }) =>
    (await api.get<{ date_from: string; date_to: string; rows: JobWorkYieldRow[] }>(`${BASE}/reports/yield/`, { params: clean(params) })).data,
  legacy: async (params: { plant?: string }) =>
    (await api.get<{ rows: JobWorkLegacyRow[]; stuck_rolls: number; open_legacy_orders: number }>(`${BASE}/legacy/`, { params: clean(params) })).data,
  reconcileLegacy: async (payload: {
    client_token: string;
    order_id?: string | null;
    action: "CONSUME" | "RETURN";
    roll_ids: string[];
    location_id?: string | null;
    output_roll_ids?: string[];
    reason: string;
  }) => (await api.post<{ order_id: string | null; action: string; rolls: Array<{ roll: string; kg: string }>; replayed?: boolean }>(`${BASE}/legacy/reconcile/`, payload)).data,
  saveVendorRate: async (payload: { client_token: string; vendor: string; process_code: string; rate: string; uom: JobWorkUom }) =>
    (await api.post<{ vendor_id: string; jobwork_rates: JobWorkRate[]; replayed?: boolean }>(`${BASE}/vendor-rates/`, payload)).data,
  /** Authenticated PDF (challan) → object URL; caller revokes it. */
  pdfObjectUrl: async (url: string) => {
    const { data } = await api.get<Blob>(url, { responseType: "blob", timeout: 60_000 });
    return URL.createObjectURL(data);
  },
};

export const JOB_WORK_STATUS_META: Record<JobWorkStatus, { label: string; hint: string; tone: "warn" | "info" | "good" | "neutral" | "bad" }> = {
  DRAFT: { label: "Draft", hint: "Order created; nothing sent yet", tone: "neutral" },
  SENT: { label: "At job worker", hint: "Material sent; nothing received back yet", tone: "info" },
  PARTLY_RETURNED: { label: "Partly returned", hint: "Some material is still at the job worker", tone: "warn" },
  RETURNED: { label: "All returned", hint: "Nothing left at the job worker — ready to close", tone: "good" },
  CLOSED: { label: "Closed", hint: "Order closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", hint: "Draft cancelled before anything was sent", tone: "bad" },
};

export const OUTPUT_KIND_LABEL: Record<JobWorkOutputKind, string> = {
  FG_PCS: "Finished pieces",
  ROLLS: "Rolls",
  BULK: "Bulk material",
};

export const UOM_LABEL: Record<JobWorkUom, string> = { PCS: "piece", KG: "kg", METER: "metre", ROLL: "roll" };
