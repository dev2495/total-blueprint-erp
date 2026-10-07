import { api } from "@/lib/api";

/*
 * Gate & Visitor Register API client.
 * Source of truth: docs/gate-api-contract.md (backend, apps.gate). Endpoints
 * and docs/gate-rbac-frontend-contract.md.
 */

export type GateDirection = "INWARD" | "OUTWARD";
export type GatePartyKind = "VENDOR" | "CUSTOMER";
export type GateProductKind = "MATERIAL" | "PRODUCT" | "TRADING" | "CONSUMABLE" | string;
export type GateReconciliation = "MATCHED" | "UNMATCHED" | "DISCREPANCY" | string;
export type VisitorStatus = "PENDING" | "INSIDE" | "EXITED" | "CANCELLED";
export type GovernmentIdType = "AADHAAR" | "PAN" | "OTHER";

export interface GatePlant {
  id: string;
  name: string;
  code: string;
}

export interface GateParty {
  kind: GatePartyKind;
  id: string;
  name: string;
  code?: string | null;
}

export interface GateProduct {
  kind: GateProductKind;
  id: string;
  name: string;
  code?: string | null;
  uom?: string | null;
}

export interface GateMasters {
  plants: GatePlant[];
  parties: GateParty[];
  products: GateProduct[];
  units: string[];
  purposes: string[];
}

export interface GateMatchLine {
  product_kind: GateProductKind;
  product_id: string;
  product_name: string;
  quantity: string | number;
  uom: string;
  amount?: string | number | null;
}

export interface GateMatchCandidate {
  kind: string;
  id: string;
  reference: string;
  party_kind: GatePartyKind;
  party_id: string;
  party_name: string;
  invoice_date?: string | null;
  vehicle_number?: string | null;
  lines: GateMatchLine[];
  amount?: string | number | null;
  amount_basis?: string | null;
  /** Source-document caveats (e.g. draft challan). Saving records them as a discrepancy. */
  warnings?: string[];
}

export interface GateMatchResult {
  status: "MATCHED" | "AMBIGUOUS" | "UNMATCHED";
  candidates: GateMatchCandidate[];
}

export interface GateGoodsLineInput {
  product_kind: GateProductKind;
  product_id: string;
  quantity: string;
  uom: string;
  amount?: string | null;
}

export interface GateGoodsInput {
  client_token: string;
  plant: string;
  direction: GateDirection;
  invoice_number: string;
  vehicle_number: string;
  party_kind: GatePartyKind;
  party_id: string;
  invoice_date?: string | null;
  lines?: GateGoodsLineInput[];
  document_kind?: string;
  document_id?: string;
  notes?: string;
}

export interface GateGoodsLine {
  id?: string;
  product_kind: GateProductKind;
  product_id: string;
  product_name: string;
  quantity: string | number;
  uom: string;
  amount?: string | number | null;
}

export interface GateDiscrepancy {
  field?: string;
  message?: string;
  expected?: unknown;
  observed?: unknown;
  [key: string]: unknown;
}

/** ERP reference as captured at match time (owner detail). */
export interface GateDocumentSnapshot {
  id?: string;
  kind?: string;
  reference?: string;
  party_name?: string;
  invoice_number?: string;
  invoice_date?: string | null;
  vehicle_number?: string | null;
  amount?: string | number | null;
  amount_basis?: string | null;
  lines?: GateMatchLine[];
  warnings?: string[];
}

export interface GateGoodsMovement {
  id: string;
  plant: string;
  plant_name?: string;
  direction: GateDirection;
  invoice_number: string;
  invoice_date?: string | null;
  vehicle_number: string;
  party_kind: GatePartyKind;
  party_id: string;
  party_name: string;
  document_kind?: string | null;
  document_id?: string | null;
  document_reference?: string | null;
  document_snapshot?: GateDocumentSnapshot | null;
  amount?: string | number | null;
  reconciliation_status: GateReconciliation;
  discrepancies?: Array<GateDiscrepancy | string> | null;
  notes?: string | null;
  logged_at: string;
  created_by_name?: string | null;
  lines: GateGoodsLine[];
  total_amount?: string | number | null;
  replayed?: boolean;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface GateVisitor {
  id: string;
  plant: string;
  plant_name?: string;
  name: string;
  mobile: string;
  purpose: string;
  company?: string | null;
  status: VisitorStatus;
  source?: "PUBLIC" | "WATCHMAN" | string;
  submitted_at: string;
  entry_at?: string | null;
  exit_at?: string | null;
  government_id_masked?: string | null;
  has_selfie?: boolean;
  selfie_url?: string | null;
}

export interface GateSummary {
  plant?: string;
  date?: string;
  inward?: number;
  outward?: number;
  goods_total?: number;
  unmatched?: number;
  discrepancies?: number;
  pending_visitors?: number;
  inside_visitors?: number;
  overdue_visitors?: number;
  visitor_entries?: number;
  visitor_exits?: number;
  [key: string]: unknown;
}

export interface GateAuditEvent {
  id: string;
  object_type: string;
  object_id: string;
  action: string;
  actor_name?: string | null;
  actor?: string | null;
  reason?: string | null;
  created_at: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  plant?: string | null;
  plant_name?: string | null;
}

export interface GateReport {
  date_from: string;
  date_to: string;
  goods_total?: number;
  inward?: number;
  outward?: number;
  unmatched?: number;
  discrepancies?: number;
  visitor_entries?: number;
  visitor_exits?: number;
  pending_visitors?: number;
  inside_visitors?: number;
  overdue_visitors?: number;
  amount_by_direction?: Record<string, string | number | null>;
  quantity_by_uom?: Record<string, string | number | null>;
  by_day?: Array<{ date: string; inward?: number; outward?: number; visitors?: number; unmatched?: number }>;
  by_plant?: Array<{ plant: string; plant_name?: string; inward?: number; outward?: number; unmatched?: number; visitors?: number }>;
  top_parties?: Array<{ party_name: string; direction?: GateDirection; movements: number }>;
  [key: string]: unknown;
}

export interface VisitorPayload {
  client_token: string;
  name: string;
  mobile: string;
  purpose: string;
  company?: string;
  government_id_type?: GovernmentIdType | "";
  government_id_number?: string;
  consent: boolean;
  selfie?: Blob | null;
}

export interface PublicGateConfig {
  company_name: string;
  plant_name?: string | null;
  plant_code?: string | null;
  purposes: string[];
  privacy_note?: string | null;
  government_id_enabled?: boolean;
}

export interface PublicVisitorReceipt {
  receipt_id: string;
  status: "PENDING";
  message?: string;
  replayed?: boolean;
}

/** Owner QR link for a plant: `GET qr/?plant=` (real SVG at `svg_url`). */
export interface GatePlantQr {
  plant_name: string;
  plant_code: string;
  gate_token: string;
  public_url: string;
  svg_url: string;
}

function cleanParams(params: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

function unwrapPage<T>(data: unknown): Paginated<T> {
  if (Array.isArray(data)) return { count: data.length, next: null, previous: null, results: data as T[] };
  const page = (data || {}) as Partial<Paginated<T>>;
  const results = Array.isArray(page.results) ? page.results : [];
  return { count: Number(page.count ?? results.length), next: page.next ?? null, previous: page.previous ?? null, results };
}

function visitorFormData(payload: VisitorPayload, extra: Record<string, string>) {
  const form = new FormData();
  form.append("client_token", payload.client_token);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  form.append("name", payload.name);
  form.append("mobile", payload.mobile);
  form.append("purpose", payload.purpose);
  if (payload.company) form.append("company", payload.company);
  if (payload.government_id_type && payload.government_id_number) {
    form.append("government_id_type", payload.government_id_type);
    form.append("government_id_number", payload.government_id_number);
  }
  form.append("consent", payload.consent ? "true" : "false");
  if (payload.selfie) form.append("selfie", payload.selfie, "selfie.jpg");
  return form;
}

export const gateApi = {
  masters: async (params: { plant?: string; q?: string }) => {
    const { data } = await api.get<GateMasters>("/api/gate/masters/", { params: cleanParams(params) });
    return {
      plants: data?.plants ?? [],
      parties: data?.parties ?? [],
      products: data?.products ?? [],
      units: data?.units ?? [],
      purposes: data?.purposes ?? [],
    } satisfies GateMasters;
  },
  match: async (params: {
    plant: string;
    direction: GateDirection;
    invoice_number: string;
    party_kind?: GatePartyKind;
    party_id?: string;
  }) => {
    const { data } = await api.get<GateMatchResult>("/api/gate/match/", { params: cleanParams(params) });
    return { status: data?.status ?? "UNMATCHED", candidates: data?.candidates ?? [] } as GateMatchResult;
  },
  createGoods: async (payload: GateGoodsInput) => {
    const { data } = await api.post<GateGoodsMovement>("/api/gate/goods/", payload, { timeout: 25000 });
    return data;
  },
  listGoods: async (params: Record<string, unknown>) => {
    const { data } = await api.get("/api/gate/goods/", { params: cleanParams(params) });
    return unwrapPage<GateGoodsMovement>(data);
  },
  getGoods: async (id: string) => {
    const { data } = await api.get<GateGoodsMovement>(`/api/gate/goods/${id}/`);
    return data;
  },
  reconcileGoods: async (id: string, payload: { client_token: string; reason: string; document_kind: string; document_id: string }) => {
    const { data } = await api.post<GateGoodsMovement>(`/api/gate/goods/${id}/reconcile/`, payload);
    return data;
  },
  correctGoods: async (
    id: string,
    payload: {
      client_token: string;
      reason: string;
      vehicle_number?: string;
      invoice_number?: string;
      invoice_date?: string | null;
      notes?: string;
      lines?: GateGoodsLineInput[];
    },
  ) => {
    const { data } = await api.post<GateGoodsMovement>(`/api/gate/goods/${id}/correct/`, payload);
    return data;
  },
  listVisitors: async (params: Record<string, unknown>) => {
    const { data } = await api.get("/api/gate/visitors/", { params: cleanParams(params) });
    return unwrapPage<GateVisitor>(data);
  },
  createWalkIn: async (plant: string, payload: VisitorPayload) => {
    const { data } = await api.post<GateVisitor>("/api/gate/visitors/", visitorFormData(payload, { plant }), { timeout: 30000 });
    return data;
  },
  checkIn: async (id: string, clientToken: string) => {
    const { data } = await api.post<GateVisitor>(`/api/gate/visitors/${id}/check-in/`, { client_token: clientToken });
    return data;
  },
  /** Visitor left without admission: PENDING -> CANCELLED with a reason. */
  cancelVisitor: async (id: string, clientToken: string, reason: string) => {
    const { data } = await api.post<GateVisitor>(`/api/gate/visitors/${id}/cancel/`, { client_token: clientToken, reason });
    return data;
  },
  checkOut: async (id: string, clientToken: string) => {
    const { data } = await api.post<GateVisitor>(`/api/gate/visitors/${id}/check-out/`, { client_token: clientToken });
    return data;
  },
  /** Authenticated private image; returned as an object URL the caller must revoke. */
  selfieObjectUrl: async (id: string) => {
    const { data } = await api.get<Blob>(`/api/gate/visitors/${id}/selfie/`, { responseType: "blob" });
    return URL.createObjectURL(data);
  },
  summary: async (plant?: string) => {
    const { data } = await api.get<GateSummary>("/api/gate/summary/", { params: cleanParams({ plant }) });
    return data ?? {};
  },
  audit: async (params: Record<string, unknown>) => {
    const { data } = await api.get("/api/gate/audit/", { params: cleanParams(params) });
    return unwrapPage<GateAuditEvent>(data);
  },
  reports: async (params: { date_from: string; date_to: string; plant?: string }) => {
    const { data } = await api.get<GateReport>("/api/gate/reports/", { params: cleanParams(params) });
    return data;
  },
  reportCsv: async (params: { date_from: string; date_to: string; plant?: string }) => {
    const { data } = await api.get<Blob>("/api/gate/reports/csv/", { params: cleanParams(params), responseType: "blob" });
    return data;
  },
  plantQr: async (plant: string) => {
    const { data } = await api.get<GatePlantQr>("/api/gate/qr/", { params: cleanParams({ plant }) });
    return data;
  },
  /** The backend-generated QR SVG text (HIGH error correction, 4-module quiet zone). */
  plantQrSvg: async (plant: string) => {
    const { data } = await api.get<string>(`/api/gate/qr/${plant}/svg/`, { responseType: "text", headers: { Accept: "image/svg+xml" } });
    return String(data);
  },
};

/*
 * Public (unauthenticated) visitor client. Uses fetch with credentials
 * omitted so a stale staff session can never turn a public visit into a
 * login redirect, and nothing about the visitor is stored in the browser.
 */
export class PublicGateError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  constructor(message: string, status: number, fields: Record<string, string> = {}, code = "") {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** The QR link carries only the opaque per-plant gate token (UUID). */
export function isValidGateToken(raw: string): boolean {
  return isUuid(String(raw || "").trim());
}

export function publicGateKey(raw: string): Record<string, string> {
  const value = String(raw || "").trim();
  return isUuid(value) ? { gate_token: value } : {};
}

async function readPublicError(response: Response): Promise<PublicGateError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const fields: Record<string, string> = {};
  let message = "";
  let code = "";
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const detail = record.detail;
    const source = detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : record;
    code = String(record.code ?? source.code ?? "").trim();
    for (const [key, value] of Object.entries(source)) {
      if (key === "detail" || key === "code") continue;
      const text = Array.isArray(value) ? value.map(String).join(" ") : typeof value === "string" ? value : "";
      if (text) fields[key] = text;
    }
    if (typeof detail === "string") message = detail;
    if (!message && fields.non_field_errors) message = fields.non_field_errors;
  }
  if (!message) {
    if (response.status === 429) message = "Too many attempts from this phone. Please wait a minute and try again.";
    else if (code === "GATE_ID_STORAGE_UNAVAILABLE") message = "ID storage is not available right now. Choose None for Government ID and submit again.";
    else if (response.status >= 500) message = "The gate server had a problem.";
    else if (response.status === 404) message = "This gate link is not active. Please ask the watchman.";
    else if (Object.keys(fields).length) message = "Please check the highlighted fields.";
    else message = "Could not reach the gate desk. Please try again.";
  }
  return new PublicGateError(message, response.status, fields, code);
}

export const publicGateApi = {
  config: async (key: string, signal?: AbortSignal): Promise<PublicGateConfig> => {
    const params = new URLSearchParams(publicGateKey(key));
    const response = await fetch(`/api/gate/public/config/?${params.toString()}`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw await readPublicError(response);
    return response.json();
  },
  submit: async (key: string, payload: VisitorPayload, signal?: AbortSignal): Promise<PublicVisitorReceipt> => {
    const response = await fetch("/api/gate/public/visitors/", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      body: visitorFormData(payload, publicGateKey(key)),
      signal,
    });
    if (!response.ok) throw await readPublicError(response);
    return response.json();
  },
};
