import { api } from "@/lib/api";

/*
 * Gate inward bill intake (camera-only arrival → inventory receiving).
 * Contract: docs/gate-bill-intake-api-contract.md and
 * docs/gate-bill-intake-rbac-contract.md (verified against apps/gate/bill_views.py).
 * Bill images are private: only fetched as authenticated blobs, never via a
 * public media URL, and never written to browser storage.
 */

export type BillStatus = "PENDING_GRN" | "PARTIAL_GRN" | "RECEIPTED" | "VOID";
export type BillQueueFilter = "OPEN" | BillStatus | "ALL";
export type ReceiptKind = "BULK" | "ROLL" | "PACKAGING" | "PO_RECEIPT" | "TRADING";
export type VoidCode = "DUPLICATE" | "NON_STOCK" | "UNREADABLE" | "CANCELLED";

export interface BillPage {
  id: string;
  page_number: number;
  width: number;
  height: number;
  byte_size: number;
  image_url: string;
}

export interface BillReceiptRef {
  kind: ReceiptKind | string;
  id: string;
  reference?: string | null;
  invoice_number?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  plant?: string | null;
  received_at?: string | null;
  quantity?: string | number | null;
  quantities_by_uom?: Record<string, string | number>;
  uom?: string | null;
  quality_status?: string | null;
}

export interface BillReviewData {
  vendor_id?: string;
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string | null;
  vehicle_number?: string;
  purchase_order_id?: string;
  purchase_order_number?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface InwardBill {
  id: string;
  plant: string;
  plant_name: string;
  arrival_at: string;
  status: BillStatus;
  created_by_name: string;
  page_count: number;
  pages: BillPage[];
  review_data: BillReviewData;
  receipt_refs: BillReceiptRef[];
  resolution_reason: string;
  resolution_code?: string | null;
  resolved_at: string | null;
  duplicate_warning?: { possible_duplicate: boolean; bill_ids: string[] };
  replayed?: boolean;
}

export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface BillSummary {
  pending_count: number;
  unread_count: number;
  plant_counts: Array<{ plant: string; plant_name: string; pending_count: number }>;
  deep_link: string;
  poll_interval_seconds: number;
  scope: "ALL_PLANTS" | "NONE" | string;
}

function clean(params: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

function asPage<T>(data: unknown): Page<T> {
  if (Array.isArray(data)) return { count: data.length, next: null, previous: null, results: data as T[] };
  const page = (data || {}) as Partial<Page<T>>;
  const results = Array.isArray(page.results) ? page.results : [];
  return { count: Number(page.count ?? results.length), next: page.next ?? null, previous: page.previous ?? null, results };
}

export const gateBillsApi = {
  /** Watchman arrival: ordered pages, one multipart request, frozen client_token. */
  upload: async (payload: { client_token: string; plant: string; images: Blob[] }, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    form.append("client_token", payload.client_token);
    form.append("plant", payload.plant);
    payload.images.forEach((image, index) => {
      const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
      form.append("images", image, `bill-page-${index + 1}.${ext}`);
    });
    const { data } = await api.post<InwardBill>("/api/gate/inward-bills/", form, {
      timeout: 120_000,
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.min(1, event.loaded / event.total));
      },
    });
    return data;
  },
  list: async (params: {
    plant?: string;
    status?: BillQueueFilter;
    search?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
  }) => {
    const { data } = await api.get("/api/gate/inward-bills/", { params: clean(params) });
    return asPage<InwardBill>(data);
  },
  /** Watchman: own arrivals today; no status/date filters (server refuses them). */
  listMine: async (plant: string, page = 1) => {
    const { data } = await api.get("/api/gate/inward-bills/", { params: clean({ plant, page, page_size: 25 }) });
    return asPage<InwardBill>(data);
  },
  get: async (id: string) => {
    const { data } = await api.get<InwardBill>(`/api/gate/inward-bills/${id}/`);
    return data;
  },
  /** Authenticated private JPEG → object URL (caller must revoke). */
  pageObjectUrl: async (imageUrl: string) => {
    const { data } = await api.get<Blob>(imageUrl, { responseType: "blob", timeout: 60_000 });
    return URL.createObjectURL(data);
  },
  pageBlob: async (imageUrl: string) => {
    const { data } = await api.get<Blob>(imageUrl, { responseType: "blob", timeout: 60_000 });
    return data;
  },
  review: async (
    id: string,
    payload: {
      client_token: string;
      vendor_id?: string;
      invoice_number?: string;
      invoice_date?: string | null;
      vehicle_number?: string;
      purchase_order_id?: string;
      notes?: string;
    },
  ) => (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/review/`, payload)).data,
  candidates: async (id: string, params: { search?: string; vendor_id?: string }) => {
    const { data } = await api.get<{ results: BillReceiptRef[]; matching_is_manual: boolean }>(
      `/api/gate/inward-bills/${id}/receipt-candidates/`,
      { params: clean(params) },
    );
    return data?.results ?? [];
  },
  linkReceipts: async (
    id: string,
    payload: { client_token: string; receipt_refs: Array<{ kind: string; id: string }>; reason: string; bill_complete?: boolean },
  ) => (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/link-receipts/`, payload)).data,
  complete: async (id: string, payload: { client_token: string; reason: string }) =>
    (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/complete/`, payload)).data,
  void: async (id: string, payload: { client_token: string; reason: string; resolution_code: VoidCode; duplicate_of?: string }) =>
    (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/void/`, payload)).data,
  /** Pending queue + unread bill alerts for the viewer. Throws on failure (never a false zero). */
  summary: async (plant?: string) =>
    (await api.get<BillSummary>("/api/users/notifications/inward-bill-summary/", { params: clean({ plant }) })).data,
};

export const BILL_STATUS_META: Record<BillStatus, { label: string; short: string; hint: string; tone: "warn" | "info" | "good" | "neutral" }> = {
  PENDING_GRN: { label: "Waiting for GRN", short: "Waiting", hint: "No receipt posted yet", tone: "warn" },
  PARTIAL_GRN: { label: "Partly received", short: "Partly received", hint: "Some lines received — more GRNs or final confirmation needed", tone: "info" },
  RECEIPTED: { label: "Received", short: "Received", hint: "Inventory confirmed every bill line received", tone: "good" },
  VOID: { label: "Resolved without GRN", short: "No GRN", hint: "Duplicate, non-stock, unreadable or cancelled — explained", tone: "neutral" },
};

export const RECEIPT_KIND_LABEL: Record<string, string> = {
  BULK: "Bulk GRN",
  ROLL: "Roll GRN",
  PACKAGING: "Packaging GRN",
  PO_RECEIPT: "PO receipt",
  TRADING: "Trading receipt",
};

export const VOID_REASONS: Array<{ code: VoidCode; label: string; hint: string }> = [
  { code: "NON_STOCK", label: "Not stock (service / equipment)", hint: "Paperwork that does not belong in the stock GRN flow" },
  { code: "DUPLICATE", label: "Duplicate of another bill", hint: "Same paperwork already uploaded at this factory" },
  { code: "UNREADABLE", label: "Unreadable photo", hint: "Ask the gate to upload a clear photo again" },
  { code: "CANCELLED", label: "Delivery cancelled / returned", hint: "Goods did not stay at the factory" },
];

export const BILL_ACCEPT = "image/jpeg,image/png,image/webp";
export const BILL_MAX_PAGES = 6;
export const BILL_MAX_BYTES = 10 * 1024 * 1024;
export const BILL_MIN_EDGE = 320;
