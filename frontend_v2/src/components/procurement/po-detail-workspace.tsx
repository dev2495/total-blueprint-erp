"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  FileDown,
  Loader2,
  Send,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  procurementService,
  type POStatus,
  type PurchaseOrder,
} from "@/services/procurement";
import { formatDisplayDateTime } from "@/lib/date-format";

const STATUS_BADGE: Record<POStatus, string> = {
  DRAFT: "bg-surface-2 text-content-2 border-line-strong",
  SENT: "bg-warning-bg text-warning-fg border-warning-border",
  ACK: "bg-info-bg text-info-fg border-info-border",
  PARTIAL: "bg-order-bg text-order-fg border-order-border",
  COMPLETED: "bg-success-bg text-success-fg border-success-border",
  CANCELLED: "bg-danger-bg text-danger-fg border-danger-border",
};

function fmtINR(value: number | string | undefined): string {
  const n = typeof value === "string" ? parseFloat(value) : value || 0;
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PurchaseOrderDetailWorkspace({ poId }: { poId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: po, isLoading } = useQuery<PurchaseOrder>({
    queryKey: ["procurement", "po", poId],
    queryFn: () => procurementService.get(poId),
  });
  const [tab, setTab] = React.useState<
    "lines" | "receipts" | "timeline" | "notes"
  >("lines");

  const sendMutation = useMutation({
    mutationFn: () => procurementService.send(poId),
    onSuccess: () => {
      toast.success("PO sent");
      qc.invalidateQueries({ queryKey: ["procurement"] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e.response?.data?.error || "Failed to send PO"),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => procurementService.cancel(poId, reason),
    onSuccess: () => {
      toast.success("PO cancelled");
      qc.invalidateQueries({ queryKey: ["procurement"] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e.response?.data?.error || "Failed to cancel"),
  });

  const closeShortMutation = useMutation({
    mutationFn: (reason: string) =>
      procurementService.closeShort(poId, null, reason),
    onSuccess: () => {
      toast.success("PO closed short");
      qc.invalidateQueries({ queryKey: ["procurement"] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e.response?.data?.error || "Failed to close short"),
  });

  if (isLoading || !po) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-content-4" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <Link
          href="/procurement/purchase-orders"
          className="inline-flex items-center gap-1 text-xs text-content-3 hover:text-brand-blue-500"
        >
          <ArrowLeft className="h-3 w-3" /> All Purchase Orders
        </Link>

        {/* Hero */}
        <div className="rounded-2xl border border-line bg-gradient-to-r from-brand-navy-500 to-brand-blue-500 p-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-white/70">
                Purchase Order
              </div>
              <h1 className="text-2xl font-semibold">{po.code}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-white/85">
                <span>{po.vendor_name}</span>
                <span>·</span>
                <span>{po.plant_name}</span>
                <span>·</span>
                <span>Order {po.order_date}</span>
                {po.expected_delivery_date && (
                  <>
                    <span>·</span>
                    <span>Expected {po.expected_delivery_date}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={`${STATUS_BADGE[po.status]} text-xs`}
              >
                {po.status}
              </Badge>
              <a
                href={procurementService.pdfUrl(poId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-surface-1/15 text-white hover:bg-surface-1/25"
                >
                  <FileDown className="mr-1 h-3.5 w-3.5" /> PDF
                </Button>
              </a>
              {po.status === "DRAFT" && (
                <Button
                  size="sm"
                  className="bg-surface-1 text-brand-navy-500 hover:bg-surface-1/90"
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                >
                  <Send className="mr-1 h-3.5 w-3.5" /> Send
                </Button>
              )}
              {(po.status === "SENT" ||
                po.status === "ACK" ||
                po.status === "PARTIAL") && (
                <Button
                  size="sm"
                  className="bg-success-fg text-white hover:bg-success-fg"
                  onClick={() =>
                    router.push(`/procurement/purchase-orders/${po.id}/receive`)
                  }
                >
                  <Truck className="mr-1 h-3.5 w-3.5" /> Receive
                </Button>
              )}
              {(po.status === "SENT" ||
                po.status === "ACK" ||
                po.status === "PARTIAL") && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-surface-1/15 text-white hover:bg-surface-1/25"
                  onClick={() => {
                    const r = window.prompt(
                      "Reason for closing short?",
                      "Vendor short delivery",
                    );
                    if (r) closeShortMutation.mutate(r);
                  }}
                >
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Close Short
                </Button>
              )}
              {po.status !== "COMPLETED" && po.status !== "CANCELLED" && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-danger-solid text-white hover:bg-danger-solid"
                  onClick={() => {
                    const r = window.prompt("Reason for cancellation?");
                    if (r) cancelMutation.mutate(r);
                  }}
                >
                  <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-line">
          {(["lines", "receipts", "timeline", "notes"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium transition ${
                tab === t
                  ? "border-b-2 border-brand-blue-500 text-brand-blue-500"
                  : "text-content-3 hover:text-content-2"
              }`}
            >
              {t === "lines" && `Lines (${po.items.length})`}
              {t === "receipts" && `Receipts (${po.receipts?.length ?? 0})`}
              {t === "timeline" &&
                `Timeline (${po.status_history?.length ?? 0})`}
              {t === "notes" && "Notes"}
            </button>
          ))}
        </div>

        {tab === "lines" && (
          <div className="overflow-hidden rounded-xl border border-line bg-surface-1 shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-content-3">
                <tr>
                  <th className="w-12 px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Open</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Progress</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((it) => (
                  <tr key={it.id} className="border-t border-line">
                    <td className="px-3 py-2 text-content-3">{it.line_no}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.material_code}</div>
                      <div className="text-xs text-content-3">
                        {it.material_name}
                      </div>
                      {it.is_closed && (
                        <div className="mt-1 text-[10px] uppercase text-danger-fg">
                          Closed Short: {it.close_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(it.qty_ordered).toFixed(3)} {it.uom}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(it.qty_received ?? 0).toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(it.qty_open ?? 0).toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtINR(it.rate_per_uom)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {fmtINR(it.line_total)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full bg-brand-blue-500"
                            style={{ width: `${it.progress_pct ?? 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-content-3 tabular-nums">
                          {it.progress_pct ?? 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-2 text-sm font-medium">
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-2 text-right text-content-3"
                  >
                    Subtotal
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtINR(po.subtotal)}
                  </td>
                  <td />
                </tr>
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-2 text-right text-content-3"
                  >
                    GST
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtINR(po.gst_total)}
                  </td>
                  <td />
                </tr>
                <tr className="text-brand-navy-500">
                  <td colSpan={6} className="px-3 py-2 text-right">
                    Grand Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    INR {fmtINR(po.grand_total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {tab === "receipts" && (
          <div className="overflow-hidden rounded-xl border border-line bg-surface-1 shadow-sm">
            {(po.receipts ?? []).length === 0 ? (
              <div className="p-8 text-center text-sm text-content-3">
                No receipts yet. Click &ldquo;Receive&rdquo; to record a GRN
                against this PO.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs uppercase tracking-wide text-content-3">
                  <tr>
                    <th className="px-3 py-2 text-left">GRN #</th>
                    <th className="px-3 py-2 text-left">Received</th>
                    <th className="px-3 py-2 text-left">Invoice</th>
                    <th className="px-3 py-2 text-left">Vehicle</th>
                    <th className="px-3 py-2 text-right">Lines</th>
                    <th className="px-3 py-2 text-left">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {(po.receipts ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2 text-content-3">
                        {formatDisplayDateTime(r.received_at)}
                      </td>
                      <td className="px-3 py-2">
                        {r.vendor_invoice_no || "—"}
                      </td>
                      <td className="px-3 py-2">{r.vehicle_no || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.lines.length}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">
                          {r.quality_status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "timeline" && (
          <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
            {(po.status_history ?? []).length === 0 ? (
              <p className="text-sm text-content-3">No status history yet.</p>
            ) : (
              <ol className="space-y-3">
                {(po.status_history ?? []).map((entry, idx) => {
                  const e = entry as {
                    status?: string;
                    at?: string;
                    by_name?: string;
                    note?: string;
                  };
                  return (
                    <li key={idx} className="flex gap-3">
                      <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-brand-blue-500" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{e.status}</span>
                          <span className="text-xs text-content-3">
                            {e.at ? formatDisplayDateTime(e.at) : ""}
                          </span>
                        </div>
                        {e.by_name && (
                          <div className="text-xs text-content-3">
                            by {e.by_name}
                          </div>
                        )}
                        {e.note && (
                          <div className="text-xs text-content-3">{e.note}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {tab === "notes" && (
          <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
            <p className="whitespace-pre-wrap text-sm text-content-2">
              {po.notes || "(no notes)"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
