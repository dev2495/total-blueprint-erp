"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function InterPlantStandalonePrintClient() {
  const params = useParams();
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const challanId = String(params?.id || "");
  const pdfUrl = `/api/inventory/inter-plant/${challanId}/print-pdf/`;

  useEffect(() => {
    let mounted = true;
    let objectUrl: string | null = null;

    const fetchPdf = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { data } = await api.get(pdfUrl, { responseType: "blob" });
        objectUrl = URL.createObjectURL(data);
        if (mounted) {
          setPdfBlobUrl(objectUrl);
        }
      } catch (err: any) {
        let message = "Unable to load PDF preview.";
        const raw = err?.response?.data;
        if (raw instanceof Blob) {
          try {
            const text = await raw.text();
            const parsed = JSON.parse(text);
            message = parsed?.error || parsed?.detail || message;
          } catch {
            // Keep default message.
          }
        } else if (typeof raw === "object" && raw) {
          message = raw?.error || raw?.detail || message;
        }
        if (mounted) {
          setLoadError(message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchPdf();

    return () => {
      mounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfUrl]);

  const triggerPrint = () => {
    if (typeof window === "undefined") return;
    setPopupBlocked(false);
    const popup = window.open(
      pdfBlobUrl || pdfUrl,
      "_blank",
      "noopener,noreferrer",
    );
    if (popup) {
      popup.focus();
      setTimeout(() => {
        try {
          popup.print();
        } catch {
          // Native PDF viewers can block script print; the viewer still has manual print.
        }
      }, 300);
    } else {
      setPopupBlocked(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-6">
      <div className="w-full max-w-5xl rounded-3xl border border-line bg-surface-1 shadow-xl">
        <div className="flex flex-col gap-4 border-b border-line px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-content-3">
              Inter-Plant Challan PDF
            </div>
            <h1 className="mt-1 text-2xl font-black text-content-1">
              Preview and Print
            </h1>
            <p className="mt-1 text-sm text-content-3">
              Challan ID {challanId || "-"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild disabled={!pdfBlobUrl && !pdfUrl}>
              <a href={pdfBlobUrl || pdfUrl} target="_blank" rel="noreferrer">
                Open PDF
              </a>
            </Button>
            <Button onClick={triggerPrint} disabled={!pdfBlobUrl && !pdfUrl}>
              Print
            </Button>
          </div>
        </div>
        <div className="space-y-4 px-6 py-5">
          {loading ? (
            <div className="text-sm text-content-3">Loading PDF preview...</div>
          ) : null}
          {loadError ? (
            <div className="rounded-2xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">
              {loadError}
            </div>
          ) : null}
          {popupBlocked ? (
            <div className="rounded-2xl border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-fg">
              Popup was blocked. Use &quot;Open PDF&quot; and print from the
              viewer.
            </div>
          ) : null}
          {!loading && !loadError ? (
            <iframe
              title="Inter-Plant Challan PDF Preview"
              src={pdfBlobUrl || pdfUrl}
              className="h-[75vh] w-full rounded-2xl border border-line"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
