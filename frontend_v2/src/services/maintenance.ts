import { api } from "@/lib/api";

/*
 * Preventive maintenance API client (backend apps.maintenance).
 * Record keeping and reports only: spares are notes on a job, never stock.
 */

export type MaintenanceKind = "OPERATOR_CHECK" | "TECH_SERVICE";
export type JobStatus = "DUE" | "IN_PROGRESS" | "DONE" | "AWAITING_VERIFICATION" | "VERIFIED" | "ISSUE_FOUND" | "UNABLE" | "CANCELLED";
export type FaultStatus = "OPEN" | "ASSIGNED" | "IN_REPAIR" | "RESOLVED" | "CLOSED" | "DISMISSED";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface MachineRef {
  id: string;
  code: string;
  name: string;
  status: string;
  work_center_name?: string;
  work_center_id?: string | null;
  plant_id?: string | null;
  plant_name?: string;
}

export interface UserRef {
  id: string;
  name: string;
  username: string;
}

export interface ChecklistItem {
  code: string;
  label: string;
  label_hi?: string;
  kind: "OK_ISSUE" | "READING";
  unit?: string;
  min?: number | null;
  max?: number | null;
}

export interface ChecklistResult {
  code: string;
  status: "OK" | "ISSUE" | "SKIPPED";
  reading?: number | null;
  note?: string;
}

export interface MaintenanceSchedule {
  id: string;
  machine: string;
  machine_detail?: MachineRef;
  name: string;
  name_hi: string;
  kind: MaintenanceKind;
  interval_type: "DAILY" | "WEEKLY" | "MONTHLY" | "RUN_HOURS";
  interval_value: number;
  due_rule: "FIXED_CALENDAR" | "AFTER_LAST_SERVICE";
  anchor_date: string;
  checklist: ChecklistItem[];
  assigned_role: "OPERATOR" | "MAINTENANCE_TECH";
  responsible_user: string | null;
  responsible_user_detail?: UserRef | null;
  requires_verification: boolean;
  is_critical: boolean;
  estimated_minutes: number;
  needs_production_stop: boolean;
  is_active: boolean;
  last_completed_at: string | null;
  next_due_date: string | null;
  run_hours_since?: number | null;
  open_job_id?: string | null;
}

export interface Attachment {
  id: string;
  url: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name: string;
  created_at: string;
}

export interface MaintenanceJob {
  id: string;
  machine: string;
  machine_detail?: MachineRef;
  schedule: string | null;
  schedule_name?: string;
  fault: string | null;
  fault_title?: string;
  source: "SCHEDULE" | "FAULT" | "MANUAL";
  kind: MaintenanceKind;
  title: string;
  title_hi: string;
  planned_date: string;
  assigned_role: "OPERATOR" | "MAINTENANCE_TECH";
  assigned_to: string | null;
  assigned_to_detail?: UserRef | null;
  status: JobStatus;
  outcome: "" | "COMPLETED" | "ISSUE" | "UNABLE";
  outcome_reason: string;
  checklist: ChecklistItem[];
  checklist_results: ChecklistResult[];
  spares_used: Array<{ item: string; qty: number; cost: number }>;
  spares_cost: string | number;
  time_minutes: number;
  notes: string;
  requires_verification: boolean;
  started_at: string | null;
  completed_at: string | null;
  completed_by_name?: string;
  verified_at: string | null;
  verified_by_name?: string;
  verification_note: string;
  attachments: Attachment[];
  is_overdue: boolean;
  created_at: string;
}

export interface MachineFault {
  id: string;
  machine: string;
  machine_detail?: MachineRef;
  title: string;
  description: string;
  severity: Severity;
  machine_running: boolean;
  status: FaultStatus;
  reported_by_name?: string;
  reported_at: string;
  assigned_to: string | null;
  assigned_to_detail?: UserRef | null;
  assigned_at: string | null;
  production_job_number?: string;
  resolved_at: string | null;
  resolved_by_name?: string;
  resolution_note: string;
  attachments: Attachment[];
  open_job_id?: string | null;
}

export interface Board {
  today: string;
  counts: { due_today: number; overdue: number; open_faults: number; machines_awaiting_repair: number; awaiting_verification: number; open_total: number };
  due_today: MaintenanceJob[];
  overdue: MaintenanceJob[];
  open_faults: MachineFault[];
  awaiting_verification: MaintenanceJob[];
  machines_awaiting_repair: MachineRef[];
}

export interface HistoryEvent {
  kind: "JOB" | "FAULT" | "DOWNTIME";
  id: string;
  at: string;
  title: string;
  status?: string;
  outcome?: string;
  planned_date?: string;
  by?: string;
  spares_cost?: number;
  time_minutes?: number;
  attachments?: number;
  severity?: string;
  machine_running?: boolean;
  resolved_at?: string | null;
  reason?: string;
  source?: string;
  hours?: number;
  job_number?: string;
  notes?: string;
}

export interface MachineScan {
  machine: MachineRef & { concurrency_policy: string; assigned_operator: string };
  viewer: { role: string; can_log_checks: boolean; can_work: boolean; can_manage: boolean; can_view_maintenance: boolean; can_run_production: boolean; can_view_production: boolean };
  production: {
    running: Array<{ id: string; job_number: string; job_state: string; status: string; order_number: string; customer: string; quantity: number; uom: string; produced_qty: number; remaining_qty: number; started_at: string | null; hold_reason: string; step_name?: string; step_output_form?: string }>;
    queued_count: number;
  };
  report_30d: { run_hours: number; downtime_hours: number; breakdowns: number; breakdown_hours: number };
  maintenance?: {
    checks_today: MaintenanceJob[];
    open_jobs: MaintenanceJob[];
    overdue_count: number;
    open_faults: MachineFault[];
    schedules: MaintenanceSchedule[];
    awaiting_verification: MaintenanceJob[];
    recent: HistoryEvent[];
  };
}

export interface LocationScan {
  location: { id: string; code: string; name: string; type: string; plant_id: string; plant_name: string; plant_code: string };
  viewer: { role: string; can_count: boolean; can_view: boolean };
  totals: { roll_count: number; roll_kg: number; bulk_lines: number; bulk_kg: number; packed_units: number; packed_pcs: number; packed_kg: number };
  roll_groups: Array<{ material_id: string; material_code: string; material_name: string; rolls: number; weight_kg: number; reserved: number }>;
  rolls: Array<{ id: string; roll_number: string; material_code: string; width_mm: number; weight_kg: number; status: string; batch_no: string }>;
  bulk: Array<{ id: string; material_id: string; material_code: string; material_name: string; category: string; granule_code: string; qty: number; uom: string; countable?: boolean; count_note?: string }>;
  adjustment_reason: string;
}

export interface QrTargets {
  origin: string;
  machines: Array<{ id: string; code: string; name: string; work_center: string; plant: string; url: string; svg_url: string }>;
  locations: Array<{ id: string; code: string; name: string; type: string; plant: string; url: string; svg_url: string }>;
}

function list<T>(data: any): T[] {
  if (Array.isArray(data)) return data as T[];
  if (Array.isArray(data?.results)) return data.results as T[];
  if (Array.isArray(data?.data)) return data.data as T[];
  return [];
}

export const maintenanceService = {
  board: async (params?: { plant_id?: string; machine_id?: string }): Promise<Board> => {
    const { data } = await api.get("/api/maintenance/board/", { params });
    return data as Board;
  },
  schedules: async (params?: Record<string, string | number | boolean>): Promise<MaintenanceSchedule[]> => {
    const { data } = await api.get("/api/maintenance/schedules/", { params: { page_size: 500, ...(params || {}) } });
    return list<MaintenanceSchedule>(data);
  },
  saveSchedule: async (payload: Partial<MaintenanceSchedule> & { id?: string }): Promise<MaintenanceSchedule> => {
    if (payload.id) {
      const { data } = await api.patch(`/api/maintenance/schedules/${payload.id}/`, payload);
      return data;
    }
    const { data } = await api.post("/api/maintenance/schedules/", payload);
    return data;
  },
  deactivateSchedule: async (id: string) => api.delete(`/api/maintenance/schedules/${id}/`),
  generateDue: async (lookaheadDays = 0) => {
    const { data } = await api.post("/api/maintenance/schedules/generate-due/", { lookahead_days: lookaheadDays });
    return data as { checked: number; created: number; today: string };
  },
  jobs: async (params?: Record<string, string | number | boolean>): Promise<MaintenanceJob[]> => {
    const { data } = await api.get("/api/maintenance/jobs/", { params: { page_size: 500, ...(params || {}) } });
    return list<MaintenanceJob>(data);
  },
  job: async (id: string): Promise<MaintenanceJob> => {
    const { data } = await api.get(`/api/maintenance/jobs/${id}/`);
    return data;
  },
  createJob: async (payload: Partial<MaintenanceJob>): Promise<MaintenanceJob> => {
    const { data } = await api.post("/api/maintenance/jobs/", payload);
    return data;
  },
  startJob: async (id: string): Promise<MaintenanceJob> => {
    const { data } = await api.post(`/api/maintenance/jobs/${id}/start/`, {});
    return data;
  },
  completeJob: async (
    id: string,
    payload: {
      outcome: "COMPLETED" | "ISSUE" | "UNABLE";
      checklist_results?: ChecklistResult[];
      time_minutes?: number;
      spares_used?: Array<{ item: string; qty: number; cost: number }>;
      notes?: string;
      outcome_reason?: string;
      fault_title?: string;
      fault_severity?: Severity;
      machine_running?: boolean;
    },
  ): Promise<MaintenanceJob> => {
    const { data } = await api.post(`/api/maintenance/jobs/${id}/complete/`, payload);
    return data;
  },
  verifyJob: async (id: string, accepted: boolean, note = ""): Promise<MaintenanceJob> => {
    const { data } = await api.post(`/api/maintenance/jobs/${id}/verify/`, { accepted, note });
    return data;
  },
  reassignJob: async (id: string, payload: { assigned_to?: string | null; planned_date?: string; note?: string }): Promise<MaintenanceJob> => {
    const { data } = await api.post(`/api/maintenance/jobs/${id}/reassign/`, payload);
    return data;
  },
  cancelJob: async (id: string, note: string): Promise<MaintenanceJob> => {
    const { data } = await api.post(`/api/maintenance/jobs/${id}/cancel/`, { note });
    return data;
  },
  jobHistory: async (id: string) => {
    const { data } = await api.get(`/api/maintenance/jobs/${id}/history/`);
    return list<any>(data);
  },
  faults: async (params?: Record<string, string | number | boolean>): Promise<MachineFault[]> => {
    const { data } = await api.get("/api/maintenance/faults/", { params: { page_size: 500, ...(params || {}) } });
    return list<MachineFault>(data);
  },
  reportFault: async (payload: { machine: string; title: string; description?: string; severity?: Severity; machine_running?: boolean }): Promise<MachineFault> => {
    const { data } = await api.post("/api/maintenance/faults/", payload);
    return data;
  },
  assignFault: async (id: string, payload: { assigned_to?: string | null; planned_date?: string; create_job?: boolean }) => {
    const { data } = await api.post(`/api/maintenance/faults/${id}/assign/`, payload);
    return data as { fault: MachineFault; job: MaintenanceJob | null };
  },
  setFaultStatus: async (id: string, status: FaultStatus, note = ""): Promise<MachineFault> => {
    const { data } = await api.post(`/api/maintenance/faults/${id}/set-status/`, { status, note });
    return data;
  },
  uploadAttachment: async (file: File, target: { job?: string; fault?: string }): Promise<Attachment> => {
    const form = new FormData();
    form.append("file", file);
    if (target.job) form.append("job", target.job);
    if (target.fault) form.append("fault", target.fault);
    const { data } = await api.post("/api/maintenance/attachments/", form, { headers: { "Content-Type": "multipart/form-data" } });
    return data;
  },
  report: async (name: "compliance" | "downtime" | "recurring-faults" | "spares" | "workload", params?: Record<string, string | number>) => {
    const { data } = await api.get(`/api/maintenance/reports/${name}/`, { params });
    return list<any>(data);
  },
  machineHistory: async (machineId: string): Promise<{ machine: MachineRef; events: HistoryEvent[] }> => {
    const { data } = await api.get(`/api/maintenance/machines/${machineId}/history/`);
    return data;
  },
  qrTargets: async (plantId?: string): Promise<QrTargets> => {
    const { data } = await api.get("/api/maintenance/qr/targets/", { params: plantId ? { plant_id: plantId } : undefined });
    return data;
  },
  scanMachine: async (code: string): Promise<MachineScan> => {
    const { data } = await api.get(`/api/maintenance/scan/machine/${encodeURIComponent(code)}/`);
    return data;
  },
  scanLocation: async (code: string): Promise<LocationScan> => {
    const { data } = await api.get(`/api/maintenance/scan/location/${encodeURIComponent(code)}/`);
    return data;
  },
};

/** Turn scanned text (a URL from our QR, or a bare code) into an app route. */
export function routeForScannedText(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const match = text.match(/\/(m|loc)\/([A-Za-z0-9_.-]+)\/?(?:[?#].*)?$/);
  if (match) return `/${match[1]}/${match[2]}`;
  if (/^[A-Za-z0-9_.-]{2,40}$/.test(text)) return `/m/${text}`;
  return null;
}
