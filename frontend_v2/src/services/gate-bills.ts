import { api } from "@/lib/api";

/*
 * Bills & documents (gate photo arrivals + office uploads → classify → receive / file).
 * Contracts: docs/gate-bill-intake-api-contract.md, docs/gate-bill-intake-rbac-contract.md
 * and docs/documents-jobwork/SPEC.md (verified against apps/gate/bill_views.py).
 * Bill images and original files are private: only fetched as authenticated
 * blobs, never via a public media URL, and never written to browser storage.
 */

export type BillStatus = "PENDING_GRN" | "PARTIAL_GRN" | "RECEIPTED" | "FILED" | "VOID";
export type BillQueueFilter =
  | "OPEN"
  | BillStatus
  | "ALL"
  | "NEEDS_CLASSIFYING"
  | "WAITING_RECEIPT"
  | "NON_STOCK_FOLLOWUP";
export type ReceiptKind = "BULK" | "ROLL" | "PACKAGING" | "PO_RECEIPT" | "TRADING" | "GENERAL_RECEIPT" | "JOBWORK_RETURN";
/** NON_STOCK only appears on old voids; new non-stock paper is filed or receipted. */
export type VoidCode = "DUPLICATE" | "UNREADABLE" | "CANCELLED" | "NOT_OUR_DOCUMENT" | "NON_STOCK";
export type DocumentSource = "GATE" | "OFFICE";
export type DocumentType =
  | "TAX_INVOICE"
  | "DELIVERY_CHALLAN"
  | "LR_TRANSPORT"
  | "DEBIT_NOTE"
  | "CREDIT_NOTE"
  | "SERVICE_REPORT"
  | "UTILITY_BILL"
  | "OTHER";
export type DocumentCategory =
  | "STOCK"
  | "JOBWORK"
  | "SPARES"
  | "MACHINERY"
  | "SERVICE"
  | "UTILITY"
  | "PROFESSIONAL_STATUTORY"
  | "TRANSPORT"
  | "OTHER_EXPENSE";
export type BillAction =
  | "view"
  | "classify"
  | "file"
  | "attach"
  | "general_receipt"
  | "link_receipts"
  | "void"
  | "grn"
  | "jobwork"
  | "complete"
  | "detach"
  | "reopen"
  | "followup"
  | "download_original";

export interface BillPage {
  id: string;
  page_number: number;
  width: number;
  height: number;
  byte_size: number;
  image_url: string;
  /** Authenticated small JPEG (`?w=320`); same privacy rules as image_url. */
  thumb_url?: string;
  /** Shared reading rotation saved by any reviewer; the stored image never changes. */
  display_rotation?: 0 | 90 | 180 | 270;
  page_kind?: "INWARD" | "OUTWARD";
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
  /** General receipts only: POSTED or REVERSED (a reversed receipt stays linked and is flagged). */
  receipt_status?: "POSTED" | "REVERSED" | string;
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

export interface DocumentLinkSummary {
  id: string;
  ref: string;
  party_display: string;
  invoice_number: string;
  status: BillStatus;
}

export interface SupportingDocument {
  id: string;
  ref: string;
  doc_type: DocumentType | "";
  doc_type_label: string;
  category: DocumentCategory | "";
  party_display: string;
  invoice_number: string;
  invoice_date: string | null;
  total_amount: string | null;
  status: BillStatus;
  arrival_at: string;
  page_count: number | null;
}

export interface OriginalFile {
  id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  page_count: number;
  created_at: string;
  download_url: string;
}

export interface DuplicateCandidate {
  id: string;
  ref: string;
  plant: string;
  plant_name: string;
  status: BillStatus;
  source: DocumentSource;
  arrival_at: string;
  party_display: string;
  invoice_number: string;
  invoice_date: string | null;
  total_amount: string | null;
}

export interface BillTimelineEvent {
  id: string;
  action: string;
  actor_name: string | null;
  reason: string;
  created_at: string;
}

export interface InwardBill {
  id: string;
  ref?: string;
  plant: string;
  plant_name: string;
  arrival_at: string;
  status: BillStatus;
  source?: DocumentSource;
  created_by_name: string;
  page_count: number;
  pages: BillPage[];
  review_data: BillReviewData;
  receipt_refs: BillReceiptRef[];
  resolution_reason: string;
  resolution_code?: string | null;
  resolved_at: string | null;
  resolved_by_name?: string | null;
  duplicate_warning?: { possible_duplicate: boolean; bill_ids: string[] };
  replayed?: boolean;
  // Document register header (office readers only; absent for the watchman).
  doc_type?: DocumentType | "";
  doc_type_label?: string;
  category?: DocumentCategory | "";
  category_label?: string;
  vendor?: string | null;
  vendor_name?: string | null;
  vendor_code?: string | null;
  party_name?: string;
  party_display?: string;
  invoice_number?: string;
  invoice_date?: string | null;
  invoice_fy?: number | null;
  taxable_amount?: string | null;
  tax_amount?: string | null;
  total_amount?: string | null;
  due_date?: string | null;
  valid_until?: string | null;
  ship_to_plant?: string | null;
  ship_to_plant_name?: string | null;
  notes?: string;
  original_invoice_ref?: string;
  classified_at?: string | null;
  classified_by_name?: string | null;
  header_version?: number;
  attached_to?: DocumentLinkSummary | null;
  supporting_documents?: SupportingDocument[];
  original_files?: OriginalFile[];
  followup?: { id: string; number: string } | null;
  needs_followup?: boolean;
  allowed_actions?: BillAction[];
  /** Detail only. */
  duplicate_candidates?: DuplicateCandidate[];
  /** Detail only: immutable audit events for this document, oldest first. */
  timeline?: BillTimelineEvent[];
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
  needs_classifying?: number;
  waiting_receipt?: number;
  partial_count?: number;
  plant_counts: Array<{ plant: string; plant_name: string; pending_count: number }>;
  deep_link: string;
  poll_interval_seconds: number;
  scope: "ALL_PLANTS" | "NONE" | string;
}

export interface DocumentHeaderInput {
  doc_type?: DocumentType | "";
  category?: DocumentCategory | "";
  vendor_id?: string | null;
  party_name?: string;
  invoice_number?: string;
  invoice_date?: string | null;
  taxable_amount?: string | null;
  tax_amount?: string | null;
  total_amount?: string | null;
  due_date?: string | null;
  valid_until?: string | null;
  ship_to_plant?: string | null;
  notes?: string;
}

export interface FormVendor {
  id: string;
  name: string;
  code: string;
  inactive?: boolean;
}

export interface FormOptions {
  plants: Array<{ id: string; name: string; code: string }>;
  vendors: FormVendor[];
  doc_types: Array<{ code: DocumentType; label: string }>;
  categories: Array<{ code: DocumentCategory; label: string; guide: string }>;
  void_codes: VoidCode[];
}

export interface RegisterFilters {
  plant?: string;
  status?: BillQueueFilter;
  category?: string;
  source?: DocumentSource | "";
  vendor?: string;
  doc_type?: string;
  date_basis?: "arrival" | "invoice";
  date_from?: string;
  date_to?: string;
  search?: string;
  ordering?: "arrival_at" | "-arrival_at" | "invoice_date" | "-invoice_date" | "total_amount" | "-total_amount";
}

export interface DocumentReportSummary {
  date_from: string;
  date_to: string;
  date_basis: "arrival" | "invoice";
  documents: number;
  by_status: Partial<Record<BillStatus, number>>;
  by_source: Partial<Record<DocumentSource, number>>;
  by_category: Array<{ category: DocumentCategory | ""; label: string; count: number; total_amount: string | null; taxable_amount: string | null; tax_amount: string | null; without_amount: number }>;
  open_ageing: Array<{ bucket: "le_1d" | "d2_3" | "d4_7" | "gt_7d"; count: number }>;
  open_total: number;
  needs_classifying: number;
  top_vendors: Array<{ vendor: string | null; name: string; count: number; total_amount: string | null }>;
  filed_count: number;
  duplicates_flagged: number;
  non_stock_followups: number;
  general_receipts: {
    count: number;
    service_count: number;
    goods_count: number;
    amount: string | null;
    by_line_category: Array<{ line_category: string; count: number; amount: string | null }>;
    by_machine: Array<{ machine: string; name: string; code: string; plant_name: string; count: number; amount: string | null }>;
  };
  amount_note: string;
}

export interface StorageReport {
  measured_at: string;
  storage_backend: string;
  tables_bytes: Record<string, number>;
  document_bytes: number;
  database_bytes: number | null;
  document_share_pct: number | null;
  page_counts: { inward_pages: number; outward_pages: number; original_files: number };
  growth_30d_bytes: number;
  projected_daily_bytes: number;
  thresholds: { database_warn_bytes: number; disk_free_warn_pct: number };
  backup_volume: { path?: string; total_bytes: number; free_bytes: number; free_pct: number | null } | null;
  days_to_database_threshold: number | null;
  days_to_disk_threshold: number | null;
  warnings: string[];
  status: "OK" | "PLAN_AHEAD" | "ACTION_NEEDED";
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

function headerForm(form: FormData, header: DocumentHeaderInput) {
  for (const [key, value] of Object.entries(header)) {
    if (value === undefined || value === null || value === "") continue;
    form.append(key, String(value));
  }
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
  /** Office upload: photos and/or PDFs (rendered server-side; original PDF kept). No gate arrival alert. */
  officeUpload: async (
    payload: { client_token: string; plant: string; files: Array<{ blob: Blob; name: string }>; header?: DocumentHeaderInput },
    onProgress?: (fraction: number) => void,
  ) => {
    const form = new FormData();
    form.append("client_token", payload.client_token);
    form.append("plant", payload.plant);
    payload.files.forEach((file) => form.append("files", file.blob, file.name));
    if (payload.header) headerForm(form, payload.header);
    const { data } = await api.post<InwardBill>("/api/gate/inward-bills/office-upload/", form, {
      timeout: 180_000,
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.min(1, event.loaded / event.total));
      },
    });
    return data;
  },
  list: async (params: RegisterFilters & { page?: number; page_size?: number }) => {
    const { data } = await api.get("/api/gate/inward-bills/", { params: clean(params as Record<string, unknown>) });
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
  /** Original uploaded file (e.g. the office PDF) as a private blob. */
  originalBlob: async (downloadUrl: string) => {
    const { data } = await api.get<Blob>(downloadUrl, { responseType: "blob", timeout: 120_000 });
    return data;
  },
  formOptions: async (params: { q?: string; vendor?: string } = {}) =>
    (await api.get<FormOptions>("/api/gate/inward-bills/form-options/", { params: clean(params) })).data,
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
  classify: async (id: string, payload: DocumentHeaderInput & { client_token: string; header_version: number }) =>
    (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/classify/`, payload)).data,
  file: async (
    id: string,
    payload: { client_token: string; reason?: string; duplicate_override_reason?: string; original_invoice_ref?: string; header_version?: number },
  ) => (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/file/`, payload)).data,
  attach: async (id: string, payload: { client_token: string; target_bill_id: string; reason: string }) =>
    (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/attach/`, payload)).data,
  detach: async (id: string, payload: { client_token: string; reason: string }) =>
    (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/detach/`, payload)).data,
  reopen: async (id: string, payload: { client_token: string; reason: string }) =>
    (await api.post<InwardBill>(`/api/gate/inward-bills/${id}/reopen/`, payload)).data,
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
  reportSummary: async (params: { plant?: string; date_from: string; date_to: string; date_basis?: "arrival" | "invoice" }) =>
    (await api.get<DocumentReportSummary>("/api/gate/document-reports/summary/", { params: clean(params) })).data,
  /** Owner/Admin: document image storage in PostgreSQL. */
  storage: async () => (await api.get<StorageReport>("/api/gate/document-reports/storage/")).data,
  registerCsv: async (params: RegisterFilters) => {
    const { data } = await api.get<Blob>("/api/gate/document-reports/register.csv", { params: clean(params as Record<string, unknown>), responseType: "blob", timeout: 120_000 });
    return data;
  },
};

export const BILL_STATUS_META: Record<BillStatus, { label: string; short: string; hint: string; tone: "warn" | "info" | "good" | "neutral" }> = {
  PENDING_GRN: { label: "Waiting for receipt", short: "Waiting", hint: "Nothing received or filed yet", tone: "warn" },
  PARTIAL_GRN: { label: "Partly received", short: "Partly received", hint: "Some lines received — more receipts or a final confirmation needed", tone: "info" },
  RECEIPTED: { label: "Received", short: "Received", hint: "Every line on the paper is confirmed received", tone: "good" },
  FILED: { label: "Filed", short: "Filed", hint: "Kept as a record (utility, fee, transport, note) — nothing to receive", tone: "good" },
  VOID: { label: "Voided", short: "Voided", hint: "Duplicate, unreadable, cancelled or not ours — explained", tone: "neutral" },
};

export const RECEIPT_KIND_LABEL: Record<string, string> = {
  BULK: "Bulk GRN",
  ROLL: "Roll GRN",
  PACKAGING: "Packaging GRN",
  PO_RECEIPT: "PO receipt",
  TRADING: "Trading receipt",
  GENERAL_RECEIPT: "General receipt",
  JOBWORK_RETURN: "Job-work return",
};

export const VOID_REASONS: Array<{ code: VoidCode; label: string; hint: string }> = [
  { code: "DUPLICATE", label: "Duplicate of another document", hint: "The same paper is already recorded (photo at the gate, PDF at the office, or a second photo)" },
  { code: "UNREADABLE", label: "Unreadable photo", hint: "Ask for a clear photo or upload the PDF again" },
  { code: "CANCELLED", label: "Delivery cancelled / returned", hint: "Goods did not stay at the factory" },
  { code: "NOT_OUR_DOCUMENT", label: "Not our document", hint: "Belongs to another company or was photographed by mistake" },
];

export const VOID_CODE_LABEL: Record<string, string> = {
  DUPLICATE: "Duplicate",
  UNREADABLE: "Unreadable photo",
  CANCELLED: "Cancelled / returned",
  NOT_OUR_DOCUMENT: "Not our document",
  NON_STOCK: "Non-stock (old rule)",
};

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  TAX_INVOICE: "Tax invoice",
  DELIVERY_CHALLAN: "Delivery challan",
  LR_TRANSPORT: "Transport LR / consignment note",
  DEBIT_NOTE: "Debit note",
  CREDIT_NOTE: "Credit note",
  SERVICE_REPORT: "Service report",
  UTILITY_BILL: "Utility bill",
  OTHER: "Other document",
};

export const CATEGORY_META: Record<DocumentCategory, { label: string; next: string; route: "grn" | "jobwork" | "general" | "file" | "attach" }> = {
  STOCK: { label: "Stock items (GRN)", next: "Post a GRN — stock goes up.", route: "grn" },
  JOBWORK: { label: "Job work", next: "Receive it against the job-work order.", route: "jobwork" },
  SPARES: { label: "Spares and parts", next: "Record a General Receipt (kept in store / installed). No stock ledger.", route: "general" },
  MACHINERY: { label: "Machinery and equipment", next: "Record a General Receipt at the factory that received it.", route: "general" },
  SERVICE: { label: "Service / repair", next: "Record a General Receipt confirming who checked the work.", route: "general" },
  UTILITY: { label: "Utility", next: "File it as a record with its due date.", route: "file" },
  PROFESSIONAL_STATUTORY: { label: "Professional / statutory fee", next: "File it; add a valid-until date for renewal reminders.", route: "file" },
  TRANSPORT: { label: "Transport / freight", next: "Attach it to the stock bill it came with, or file it.", route: "attach" },
  OTHER_EXPENSE: { label: "Other expense", next: "File it as a record.", route: "file" },
};

export const RECORD_ONLY_CATEGORIES: DocumentCategory[] = ["UTILITY", "PROFESSIONAL_STATUTORY", "TRANSPORT", "OTHER_EXPENSE"];
export const FILEABLE_DOC_TYPES: DocumentType[] = ["DEBIT_NOTE", "CREDIT_NOTE", "SERVICE_REPORT", "UTILITY_BILL", "OTHER"];

export const BILL_ACCEPT = "image/jpeg,image/png,image/webp";
export const BILL_MAX_PAGES = 6;
export const BILL_MAX_BYTES = 10 * 1024 * 1024;
export const BILL_MIN_EDGE = 320;
/** Office upload: photos and PDFs, up to 20 pages per document. */
export const OFFICE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.pdf";
export const OFFICE_MAX_PAGES = 20;
export const OFFICE_MAX_FILES = 20;
export const OFFICE_PDF_MAX_BYTES = 15 * 1024 * 1024;
