"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Camera, ChevronDown, FileText, FileUp, Loader2, Trash2, UploadCloud } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { gateErrorMessage, useGateOperation } from "@/components/gate/use-gate-operation";
import {
  CATEGORY_META,
  DOCUMENT_TYPE_LABEL,
  gateBillsApi,
  OFFICE_MAX_FILES,
  OFFICE_MAX_PAGES,
  OFFICE_PDF_MAX_BYTES,
  BILL_MAX_BYTES,
  type DocumentCategory,
  type DocumentHeaderInput,
  type DocumentType,
  type InwardBill,
} from "@/services/gate-bills";
import { localIsoDate } from "@/components/inventory/gate-bills/bill-common";
import { FieldError, PlantSelect, VendorPicker, fieldClass, labelClass, type PartyValue } from "./shared";

type Picked = { key: string; file: File; kind: "image" | "pdf"; preview: string | null };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

let pickedSeq = 0;

/**
 * Office upload: photos (camera or files) and/or PDFs → one document.
 * One human action = one frozen client_token; an unconfirmed send can only be
 * retried with the identical files, never duplicated.
 */
export function UploadBillDialog({ open, onClose, defaultPlant }: { open: boolean; onClose: () => void; defaultPlant?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [plant, setPlant] = useState(defaultPlant ?? "");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showHeader, setShowHeader] = useState(false);
  const [party, setParty] = useState<PartyValue>({ vendorId: null, vendorName: "", partyName: "" });
  const [docType, setDocType] = useState<DocumentType | "">("");
  const [category, setCategory] = useState<DocumentCategory | "">("");
  const [invoice, setInvoice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [total, setTotal] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const op = useGateOperation<{ plant: string; files: Array<{ blob: Blob; name: string }>; header: DocumentHeaderInput }, InwardBill>({
    send: (payload) => gateBillsApi.officeUpload(payload, setProgress),
    onSaved: (saved) => {
      void qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
      router.push(`/inventory/gate-bills/${saved.id}`);
    },
  });

  useEffect(() => {
    if (!open) {
      setPicked((current) => {
        current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
        return [];
      });
      setProblem(null);
      setProgress(0);
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && defaultPlant && !plant) setPlant(defaultPlant);
  }, [open, defaultPlant, plant]);

  const imageCount = picked.filter((p) => p.kind === "image").length;
  const pdfCount = picked.length - imageCount;

  const addFiles = (list: FileList | File[] | null) => {
    if (!list || op.locked) return;
    const next: Picked[] = [];
    const errors: string[] = [];
    let images = imageCount;
    for (const file of Array.from(list)) {
      if (picked.length + next.length >= OFFICE_MAX_FILES) {
        errors.push(`Up to ${OFFICE_MAX_FILES} files per document.`);
        break;
      }
      if (isPdf(file)) {
        if (file.size > OFFICE_PDF_MAX_BYTES) errors.push(`${file.name} is larger than 15 MB.`);
        else next.push({ key: `p${++pickedSeq}`, file, kind: "pdf", preview: null });
      } else if (IMAGE_TYPES.has(file.type)) {
        if (file.size > BILL_MAX_BYTES) errors.push(`${file.name} is larger than 10 MB.`);
        else if (images >= OFFICE_MAX_PAGES) errors.push(`${file.name}: up to ${OFFICE_MAX_PAGES} pages per document.`);
        else {
          images += 1;
          next.push({ key: `p${++pickedSeq}`, file, kind: "image", preview: URL.createObjectURL(file) });
        }
      } else {
        errors.push(`${file.name}: use a JPEG, PNG or WebP photo, or a PDF. Convert HEIC photos to JPEG first.`);
      }
    }
    setProblem(errors.length ? `Not added: ${errors.join(" ")}` : null);
    setPicked((current) => [...current, ...next].slice(0, OFFICE_MAX_FILES));
    op.reset();
  };

  const move = (index: number, delta: number) =>
    setPicked((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const copy = current.slice();
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  const remove = (key: string) =>
    setPicked((current) => {
      const found = current.find((p) => p.key === key);
      if (found?.preview) URL.revokeObjectURL(found.preview);
      return current.filter((p) => p.key !== key);
    });

  const header: DocumentHeaderInput = useMemo(() => {
    if (!showHeader) return {};
    return {
      doc_type: docType || undefined,
      category: category || undefined,
      vendor_id: party.vendorId || undefined,
      party_name: party.vendorId ? undefined : party.partyName.trim() || undefined,
      invoice_number: invoice.trim() || undefined,
      invoice_date: invoiceDate || undefined,
      total_amount: total.trim() || undefined,
    };
  }, [showHeader, docType, category, party, invoice, invoiceDate, total]);

  const canSend = Boolean(plant) && picked.length > 0;
  const submit = () => {
    if (op.phase === "uncertain") return void op.retry();
    if (!canSend) return;
    setProgress(0);
    void op.submit({ plant, files: picked.map((p) => ({ blob: p.file, name: p.file.name })), header });
  };
  const sending = op.phase === "sending";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !op.locked && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-[720px] overflow-y-auto">
        <DialogTitle>Upload bill</DialogTitle>
        <DialogDescription>
          Bills that reached the office (email, courier, hand-delivered). Photos and PDFs become one document; the original PDF is kept. Nothing is
          received or posted until you classify it.
        </DialogDescription>
        <div className="space-y-4">
          <PlantSelect value={plant} onChange={setPlant} label="Factory the bill belongs to" allLabel={null} disabled={op.locked} required />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!op.locked) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={cn("rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors", dragOver ? "border-primary bg-info-bg" : "border-line bg-surface-2")}
          >
            <UploadCloud className="mx-auto h-7 w-7 text-content-4" aria-hidden />
            <p className="mt-2 text-[13px] text-content-2">Drop photos or PDFs here, or</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" disabled={op.locked} onClick={() => fileRef.current?.click()} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-1 px-4 text-[13px] font-semibold text-content-1 hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
                <FileUp className="h-4 w-4" /> Choose files
              </button>
              <button type="button" disabled={op.locked} onClick={() => cameraRef.current?.click()} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-1 px-4 text-[13px] font-semibold text-content-1 hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
                <Camera className="h-4 w-4" /> Take photo
              </button>
            </div>
            <p className="mt-2 text-[12px] text-content-4">JPEG / PNG / WebP up to 10 MB each · PDF up to 15 MB · up to {OFFICE_MAX_PAGES} pages in total</p>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </div>
          {problem ? <p role="alert" className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-content-1">{problem}</p> : null}
          {picked.length ? (
            <ol className="space-y-2" aria-label="Pages in upload order">
              {picked.map((item, index) => (
                <li key={item.key} className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 p-2">
                  <span className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
                    {item.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.preview} alt={`Page ${index + 1} preview`} className="h-full w-full object-cover object-top" />
                    ) : (
                      <FileText className="h-6 w-6 text-content-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-content-1">{item.file.name}</span>
                    <span className="block text-[12px] text-content-3">
                      {item.kind === "pdf" ? "PDF · every page becomes an image" : "Photo"} · {sizeLabel(item.file.size)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" disabled={op.locked || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${item.file.name} up`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-line disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={op.locked || index === picked.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${item.file.name} down`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-line disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={op.locked} onClick={() => remove(item.key)} aria-label={`Remove ${item.file.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-danger-fg disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {picked.length ? (
            <p className="text-[12px] text-content-3">
              {imageCount} photo{imageCount === 1 ? "" : "s"} · {pdfCount} PDF{pdfCount === 1 ? "" : "s"}. Page order follows this list; PDF pages stay in their own order.
            </p>
          ) : null}

          <div className="rounded-2xl border border-line">
            <button
              type="button"
              aria-expanded={showHeader}
              onClick={() => setShowHeader((v) => !v)}
              className="flex min-h-[48px] w-full items-center justify-between gap-2 px-4 text-left text-[13px] font-semibold text-content-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
            >
              Add bill details now (optional)
              <ChevronDown className={cn("h-4 w-4 transition-transform", showHeader ? "rotate-180" : "")} aria-hidden />
            </button>
            {showHeader ? (
              <fieldset disabled={op.locked} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <VendorPicker value={party} onChange={setParty} />
                </div>
                <label className={labelClass}>
                  Document type
                  <select value={docType} onChange={(e) => setDocType(e.target.value as DocumentType | "")} className={cn(fieldClass, "mt-1")}>
                    <option value="">Not set</option>
                    {Object.entries(DOCUMENT_TYPE_LABEL).map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Category
                  <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory | "")} className={cn(fieldClass, "mt-1")}>
                    <option value="">Decide later</option>
                    {Object.entries(CATEGORY_META).map(([code, meta]) => (
                      <option key={code} value={code}>{meta.label}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Bill / invoice number
                  <input value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={80} className={cn(fieldClass, "mt-1 font-mono")} />
                </label>
                <label className={labelClass}>
                  Bill date
                  <input type="date" value={invoiceDate} max={localIsoDate()} onChange={(e) => setInvoiceDate(e.target.value)} className={cn(fieldClass, "mt-1")} />
                </label>
                <label className={labelClass}>
                  Bill total (₹)
                  <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(fieldClass, "mt-1 tabular-nums")} />
                </label>
              </fieldset>
            ) : null}
          </div>

          {sending ? (
            <div role="status" className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="text-[12px] text-content-3">{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Uploaded — preparing pages (PDFs take a few seconds)…"}</p>
            </div>
          ) : null}
          {op.phase === "rejected" ? <FieldError message={gateErrorMessage(op.error, "The upload was refused. Nothing was saved.")} /> : null}
          {op.phase === "uncertain" ? (
            <div role="alert" className="space-y-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] text-content-1">
              <p>
                <b>Upload not confirmed</b> ({gateErrorMessage(op.error)}). Sending again uses the same files and the same request, so the bill can never be
                saved twice.
              </p>
              <button type="button" onClick={() => { if (window.confirm("Only discard if the register does not show this upload. Discard it?")) op.release(); }} className="min-h-[36px] text-[12px] font-semibold text-content-3 underline">
                I checked the register — discard and start again
              </button>
            </div>
          ) : null}
          {op.phase === "saved" ? <p role="status" className="text-[13px] font-semibold text-success-fg">Uploaded — opening the document…</p> : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={onClose} disabled={op.locked} className="min-h-[44px] rounded-xl border border-line px-4 text-[13px] font-semibold text-content-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={(!canSend && op.phase !== "uncertain") || sending || op.phase === "saved"}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {op.phase === "uncertain" ? "Send the same upload again" : `Upload ${picked.length ? `${picked.length} file${picked.length === 1 ? "" : "s"}` : ""}`}
            </button>
          </div>
          {!plant && picked.length ? <p className="text-right text-[12px] text-warning-fg">Choose the factory first.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
