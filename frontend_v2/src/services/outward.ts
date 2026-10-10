import { api } from "@/lib/api";
import type { BillPage } from "@/services/gate-bills";

/*
 * Outward gate documents: the watchman photographs every paper leaving with
 * goods (optionally scanning the ERP QR first); the inventory office matches
 * each departure to its ERP documents. Never moves stock.
 * Contract: apps/gate/outward_views.py, apps/gate/qr_views.py (QR token, QR gate sticker PDF).
 * Page images are private: fetched as authenticated blobs only.
 */

export type OutwardStatus = "PENDING_MATCH" | "MATCHED" | "DISCREPANCY" | "VOID";
export type OutwardQueueFilter = OutwardStatus | "OPEN" | "ALL";
export type OutwardLinkKind =
  | "SALES_DC"
  | "CUSTOMER_DISPATCH"
  | "TRADE_ORDER"
  | "INTERPLANT_DC"
  | "JOBWORK_CHALLAN"
  | "GATE_PASS"
  | "OTHER";
/** ERP documents that carry a signed gate QR (printed PDFs and QR gate stickers). */
export type GateQrKind = Exclude<OutwardLinkKind, "OTHER">;

export interface OutwardSnapshotLine {
  description: string;
  quantity: string | null;
  uom: string;
}

/** OutwardLinkSnapshot (SPEC §3.2). Never carries prices. */
export interface OutwardSnapshot {
  kind: OutwardLinkKind;
  id: string | null;
  reference: string;
  party_name: string;
  plant: string | null;
  plant_name: string;
  status: string;
  document_date: string | null;
  lines: OutwardSnapshotLine[];
  line_count?: number;
  summary: string;
  warnings: string[];
}

export interface OtherDeparture {
  document_id: string;
  departed_at: string;
  vehicle_number: string;
  plant_name: string;
  status: OutwardStatus;
}

export interface OutwardLink {
  id: string;
  kind: OutwardLinkKind;
  kind_label: string;
  reference: string;
  party_name: string;
  object_id?: string | null;
  summary?: string;
  snapshot?: OutwardSnapshot;
  link_source?: "QR" | "MANUAL";
  linked_at?: string;
  linked_by_name?: string;
  active?: boolean;
  removed_at?: string | null;
  removed_by_name?: string;
  removed_reason?: string;
  other_departures?: OtherDeparture[];
}

export interface ScannedRef {
  status: "LINKED" | "INVALID" | "DUPLICATE_SCAN";
  kind?: OutwardLinkKind | null;
  kind_label?: string;
  reference?: string;
  error?: string;
  code?: string;
  object_id?: string | null;
}

export interface OutwardTimelineEvent {
  id: string;
  action: string;
  actor_name: string;
  reason: string;
  created_at: string;
}

export interface OutwardDocument {
  id: string;
  reference: string;
  plant: string;
  plant_name: string;
  departed_at: string;
  status: OutwardStatus;
  status_label: string;
  vehicle_number: string;
  created_by_name: string;
  page_count: number;
  pages: BillPage[];
  links: OutwardLink[];
  link_count: number;
  scanned_refs: ScannedRef[];
  // Office (outward.reconcile) fields
  notes?: string;
  matched_at?: string | null;
  matched_by_name?: string;
  resolution_reason?: string;
  discrepancies?: Array<{ notes: string; by: string; at: string }>;
  removed_links?: OutwardLink[];
  timeline?: OutwardTimelineEvent[];
  voided_at?: string | null;
  voided_by_name?: string;
  duplicate_photos?: Array<{ document_id: string; departed_at: string; status: OutwardStatus }>;
  can_void?: boolean;
  replayed?: boolean;
  link_warnings?: OtherDeparture[];
}

export type OutwardCounts = Record<"PENDING_MATCH" | "DISCREPANCY" | "MATCHED" | "VOID" | "OPEN" | "ALL", number>;

export interface OutwardListPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: OutwardDocument[];
  counts?: OutwardCounts;
  recent_vehicles?: string[];
  /** Factories the matching team can filter by (office list only). */
  plants?: { id: string; name: string; code: string }[];
}

export interface QrChip {
  kind: OutwardLinkKind;
  kind_label: string;
  id: string;
  reference: string;
  party_name: string;
  summary: string;
  status: string;
  warnings: string[];
  snapshot?: OutwardSnapshot;
}

export interface OutwardCandidate extends OutwardSnapshot {
  kind_label: string;
  linked_here: boolean;
  other_departures: OtherDeparture[];
}

export interface CandidateResult {
  results: OutwardCandidate[];
  kinds: Array<{ value: OutwardLinkKind; label: string }>;
  query: string;
}

function clean(params: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

function asPage(data: unknown): OutwardListPage {
  const page = (data || {}) as Partial<OutwardListPage>;
  const results = Array.isArray(page.results) ? page.results : [];
  return {
    count: Number(page.count ?? results.length),
    next: page.next ?? null,
    previous: page.previous ?? null,
    results,
    counts: page.counts,
    recent_vehicles: Array.isArray(page.recent_vehicles) ? page.recent_vehicles : [],
    plants: Array.isArray(page.plants) ? page.plants : [],
  };
}

export const OUTWARD_MAX_PAGES = 6;
export const OUTWARD_MAX_CODES = 10;

export const outwardApi = {
  /** Watchman departure: ordered pages + scanned codes, one multipart request, frozen client_token. */
  capture: async (
    payload: { client_token: string; plant: string; images: Blob[]; vehicle_number?: string; scanned_codes?: string[] },
    onProgress?: (fraction: number) => void,
  ) => {
    const form = new FormData();
    form.append("client_token", payload.client_token);
    form.append("plant", payload.plant);
    form.append("vehicle_number", payload.vehicle_number ?? "");
    (payload.scanned_codes ?? []).forEach((code) => form.append("scanned_codes", code));
    payload.images.forEach((image, index) => {
      const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
      form.append("images", image, `outward-page-${index + 1}.${ext}`);
    });
    const { data } = await api.post<OutwardDocument>("/api/gate/outward-documents/", form, {
      timeout: 120_000,
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.min(1, event.loaded / event.total));
      },
    });
    return data;
  },
  /** Watchman: own departures today at this gate (+ recent vehicles at the gate). */
  listMine: async (plant: string, page = 1) => {
    const { data } = await api.get("/api/gate/outward-documents/", { params: clean({ plant, page, page_size: 25 }) });
    return asPage(data);
  },
  /** Office queue (outward.reconcile). */
  list: async (params: {
    status?: OutwardQueueFilter;
    plant?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
    has_links?: "true" | "false";
    page?: number;
    page_size?: number;
  }) => {
    const { data } = await api.get("/api/gate/outward-documents/", { params: clean(params) });
    return asPage(data);
  },
  get: async (id: string) => (await api.get<OutwardDocument>(`/api/gate/outward-documents/${id}/`)).data,
  candidates: async (id: string, params: { q?: string; kind?: OutwardLinkKind }) =>
    (await api.get<CandidateResult>(`/api/gate/outward-documents/${id}/candidates/`, { params: clean(params) })).data,
  link: async (
    id: string,
    payload: { client_token: string; kind: OutwardLinkKind; object_id?: string; reference?: string; party_name?: string; reason?: string },
  ) => (await api.post<OutwardDocument>(`/api/gate/outward-documents/${id}/link/`, payload)).data,
  unlink: async (id: string, payload: { client_token: string; link_id: string; reason: string }) =>
    (await api.post<OutwardDocument>(`/api/gate/outward-documents/${id}/unlink/`, payload)).data,
  discrepancy: async (id: string, payload: { client_token: string; notes: string }) =>
    (await api.post<OutwardDocument>(`/api/gate/outward-documents/${id}/discrepancy/`, payload)).data,
  resolve: async (id: string, payload: { client_token: string; reason?: string }) =>
    (await api.post<OutwardDocument>(`/api/gate/outward-documents/${id}/resolve/`, payload)).data,
  void: async (id: string, payload: { client_token: string; reason: string }) =>
    (await api.post<OutwardDocument>(`/api/gate/outward-documents/${id}/void/`, payload)).data,
  /** Watchman chip / office link-by-code. 400 = not an ERP code or not usable here. */
  resolveCode: async (code: string, plant: string) =>
    (await api.get<QrChip>("/api/gate/qr/resolve/", { params: { code, plant }, timeout: 15_000 })).data,
  qrToken: async (kind: Exclude<OutwardLinkKind, "OTHER">, id: string) =>
    (await api.get<{ kind: string; id: string; token: string; svg: string }>("/api/gate/qr/token/", { params: { kind, id } })).data,
  /**
   * QR gate sticker PDF (101.6 × 50.8 mm label, one page per copy) → object URL; caller revokes it.
   * 403 no access, 404 record missing, 409 cancelled / cannot leave the gate.
   */
  qrLabelObjectUrl: async (kind: GateQrKind, id: string, copies = 1) => {
    const { data } = await api.get<Blob>("/api/gate/qr/label.pdf", { params: { kind, id, copies }, responseType: "blob", timeout: 60_000 });
    return URL.createObjectURL(data);
  },
};

export const OUTWARD_STATUS_META: Record<OutwardStatus, { label: string; short: string; hint: string; tone: "warn" | "info" | "good" | "neutral" | "bad" }> = {
  PENDING_MATCH: { label: "Pending match", short: "To match", hint: "No ERP document confirmed yet", tone: "warn" },
  DISCREPANCY: { label: "Discrepancy", short: "Discrepancy", hint: "The office found a difference to follow up", tone: "bad" },
  MATCHED: { label: "Matched", short: "Matched", hint: "Linked to the ERP documents that left", tone: "good" },
  VOID: { label: "Voided", short: "Voided", hint: "Recorded by mistake; kept for audit", tone: "neutral" },
};

export const OUTWARD_KIND_LABEL: Record<OutwardLinkKind, string> = {
  SALES_DC: "Sales delivery challan",
  CUSTOMER_DISPATCH: "Customer dispatch / invoice",
  TRADE_ORDER: "Trade order invoice",
  INTERPLANT_DC: "Inter-plant challan",
  JOBWORK_CHALLAN: "Job-work challan",
  GATE_PASS: "Gate pass (RGP / NRGP)",
  OTHER: "Other paper",
};

/** "TPP1.KIND.uuid.sig" — cheap client check before asking the server. */
export function looksLikeErpCode(value: string): boolean {
  return /^TPP1\.[A-Z_]{3,24}\.[0-9a-fA-F-]{36}\.[0-9a-f]{16}$/.test(value.trim());
}
