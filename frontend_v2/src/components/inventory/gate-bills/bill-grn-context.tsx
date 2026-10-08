"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, FileImage, Inbox, Loader2 } from "lucide-react";

import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BILL_STATUS_META, gateBillsApi, type InwardBill } from "@/services/gate-bills";
import { gateErrorMessage, isUncertainFailure, newClientToken } from "@/components/gate/use-gate-operation";
import { BillStatusPill, billDateTime, billRef } from "./bill-common";
import { invalidateBillViews, ReceiptList, useBill } from "./bill-detail";
import { BillViewer } from "./bill-viewer";

export type BillPostKind = "UNIFIED" | "PO_RECEIPT" | "TRADING";
export type BillPostWrapper = <T>(kind: BillPostKind, body: Record<string, unknown>, call: (body: Record<string, unknown>) => Promise<T>) => Promise<T>;

type Frozen = { kind: BillPostKind; body: Record<string, unknown>; pathname: string };

/**
 * Smart GRN ↔ gate bill context. When `?inward_bill_id=` is present:
 * - the bill's plant fixes which receiving locations are offered,
 * - every post (unified BULK/ROLL/PACKAGING, PO receipt, trading receipt)
 *   carries inward_bill_id + a frozen client_token + bill_complete, so the
 *   backend links the bill atomically with the stock posting,
 * - an uncertain failure (timeout/offline/5xx) freezes the exact body + token;
 *   the next submit resends it unchanged so a retry can never post twice.
 * Without the parameter the form behaves exactly as before.
 */
export function useGrnBillContext() {
  const params = useSearchParams();
  const pathname = usePathname() || "/inventory/grn";
  const raw = params?.get("inward_bill_id") ?? "";
  const requested = params?.has("inward_bill_id") ?? false;
  const billId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : "";
  const qc = useQueryClient();
  const billQ = useBill(billId, Boolean(billId));
  const frozen = useRef<Frozen | null>(null);
  const [uncertain, setUncertain] = useState<null | { error: unknown; kind: BillPostKind }>(null);
  const [billComplete, setBillComplete] = useState(false);
  const [lastLinked, setLastLinked] = useState<null | { billId: string; status: string; grn: string }>(null);
  const billStatus = billQ.data?.status;
  // A requested bill is mandatory context; never silently post unlinked stock.
  const linkable = Boolean(billId) && (billStatus === "PENDING_GRN" || billStatus === "PARTIAL_GRN");

  const wrapPost: BillPostWrapper = useCallback(
    async (kind, body, call) => {
      if (frozen.current && (!requested || String(frozen.current.body.inward_bill_id).toLowerCase() !== billId.toLowerCase())) {
        throw new Error("An earlier GRN belongs to another gate bill. Reopen the original bill link to retry it before starting another receipt.");
      }
      if (!requested) return call(body);
      if (!billId) throw new Error("The gate bill link is invalid. Open the bill from the receiving queue again.");
      if (frozen.current && frozen.current.kind !== kind) {
        throw new Error("An earlier GRN is unconfirmed. Retry its original receiving type before starting another GRN.");
      }
      if (!linkable && !frozen.current) {
        throw new Error(billQ.data ? "This gate bill is already closed. Choose another pending bill." : "Wait for the gate bill to load, or retry its connection before posting.");
      }
      if (!frozen.current && !String(body.vendor_invoice_no ?? "").trim()) {
        throw new Error("Enter the invoice or delivery reference printed on this bill before posting the GRN.");
      }
      let current = frozen.current;
      if (!current || current.kind !== kind) {
        const token = newClientToken();
        current = { kind, pathname, body: JSON.parse(JSON.stringify({ ...body, inward_bill_id: billId, client_token: token, bill_complete: billComplete })) };
        frozen.current = current;
      }
      try {
        const result = await call(current.body);
        frozen.current = null;
        setUncertain(null);
        return result;
      } catch (error) {
        if (isUncertainFailure(error)) {
          setUncertain({ error, kind });
        } else {
          // Definitive refusal: nothing posted, token retired.
          frozen.current = null;
          setUncertain(null);
          if (getApiErrorStatus(error) === 409) void invalidateBillViews(qc, billId);
        }
        throw error;
      }
    },
    [billId, billComplete, linkable, requested, billQ.data, pathname, qc],
  );

  const onPosted = useCallback(
    (response: unknown, grnLabel: string) => {
      const linked = (response as { inward_bill?: { id?: string; status?: string } } | null)?.inward_bill;
      const linkedId = linked?.id || billId;
      if (!linkedId || !linked) return;
      setLastLinked({ billId: linkedId, status: String(linked?.status || ""), grn: grnLabel });
      setBillComplete(false);
      void invalidateBillViews(qc, linkedId);
    },
    [billId, qc],
  );

  const discardPending = useCallback(() => {
    frozen.current = null;
    setUncertain(null);
  }, []);

  return {
    billId,
    requested,
    bill: billQ.data ?? null,
    billQ,
    plantId: billQ.data?.plant ?? "",
    wrapPost,
    onPosted,
    billComplete,
    setBillComplete,
    uncertain,
    discardPending,
    lastLinked,
    hasFrozen: () => Boolean(frozen.current),
    pendingBillId: frozen.current ? String(frozen.current.body.inward_bill_id) : "",
    pendingRetryHref: frozen.current ? `${frozen.current.pathname}?inward_bill_id=${frozen.current.body.inward_bill_id}` : "",
  };
}

export type GrnBillContext = ReturnType<typeof useGrnBillContext>;

function NextPendingLink({ currentId }: { currentId: string }) {
  const q = useQuery({
    queryKey: ["inventory", "gate-bills", "next", currentId],
    queryFn: () => gateBillsApi.list({ status: "OPEN", page_size: 5 }),
    meta: { suppressGlobalError: true },
  });
  const next = (q.data?.results ?? []).find((b) => b.id !== currentId);
  if (!next) return null;
  return (
    <Link href={`/inventory/grn?inward_bill_id=${next.id}`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line bg-surface-1 px-3 text-[12.5px] font-semibold text-content-1">
      Next pending bill ({billRef(next.id)}) <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/** Banner + private viewer shown above the GRN form while receiving a gate bill. */
export function GrnBillBanner({ ctx }: { ctx: GrnBillContext }) {
  const [showPhoto, setShowPhoto] = useState(true);
  if (ctx.pendingBillId && (!ctx.requested || ctx.pendingBillId.toLowerCase() !== ctx.billId.toLowerCase())) {
    return (
      <div role="alert" className="rounded-2xl border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-content-1" data-testid="grn-bill-context">
        A GRN for bill {billRef(ctx.pendingBillId)} is still unconfirmed. Posting is paused until you reopen its original bill. {" "}
        <Link href={ctx.pendingRetryHref} className="font-semibold text-primary underline">Reopen original bill to retry</Link>
      </div>
    );
  }
  if (!ctx.requested) return null;
  const { bill, billQ } = ctx;
  if (!bill) {
    return (
      <div className="rounded-2xl border border-line bg-surface-1 px-4 py-3 text-[13px] text-content-2" data-testid="grn-bill-context">
        {billQ.isLoading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading gate bill…
          </span>
        ) : (
          <span className="text-danger-fg">
            Gate bill could not be loaded ({gateErrorMessage(billQ.error, "unavailable")}). Posting is paused until a valid pending bill is loaded.{" "}
            <Link href="/inventory/gate-bills" className="font-semibold underline">
              Open gate bills
            </Link>
          </span>
        )}
      </div>
    );
  }
  const open = bill.status === "PENDING_GRN" || bill.status === "PARTIAL_GRN";
  return (
    <section className="rounded-2xl border border-info-border bg-surface-1 shadow-sm" data-testid="grn-bill-context" aria-label="Gate bill being received">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-info-bg text-info-fg">
          <Inbox className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-content-1">
            Receiving gate bill <span className="font-mono">{billRef(bill.id)}</span> · {bill.plant_name}
            <BillStatusPill status={bill.status} />
          </div>
          <div className="text-[12px] text-content-3">
            Arrived {billDateTime(bill.arrival_at)} · {bill.page_count} page{bill.page_count === 1 ? "" : "s"} · receiving location is limited to {bill.plant_name}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowPhoto((v) => !v)}
          aria-expanded={showPhoto}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line px-3 text-[12.5px] font-semibold text-content-2"
        >
          <FileImage className="h-4 w-4" /> {showPhoto ? "Hide photo" : "Show photo"} {showPhoto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <Link href={`/inventory/gate-bills/${bill.id}`} className="inline-flex min-h-[40px] items-center rounded-xl px-3 text-[12.5px] font-semibold text-primary hover:underline">
          Open bill
        </Link>
      </div>

      <div className={cn("grid gap-4 p-4", showPhoto ? "xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]" : "")}>
        {showPhoto ? <BillViewer pages={bill.pages} billLabel={`Bill ${billRef(bill.id)}`} compact /> : null}
        <div className="min-w-0 space-y-3">
          {!open ? (
            <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] text-content-1">
              This bill is already {BILL_STATUS_META[bill.status]?.label.toLowerCase()}. Choose a pending bill before posting another GRN.{" "}
              <Link href="/inventory/gate-bills" className="font-semibold text-primary underline">
                Choose another bill
              </Link>
            </div>
          ) : (
            <label className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-content-2">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5"
                checked={ctx.billComplete}
                onChange={(e) => ctx.setBillComplete(e.target.checked)}
                disabled={Boolean(ctx.uncertain)}
              />
              <span>
                <span className="block font-semibold text-content-1">This GRN completes the bill</span>
                Tick only if every line on the bill is received with this post. Otherwise the bill stays “Partly received” for more GRNs.
              </span>
            </label>
          )}
          {(bill.receipt_refs || []).length ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4">Already linked to this bill</div>
              <ReceiptList refs={bill.receipt_refs} />
            </div>
          ) : null}
          {ctx.uncertain ? (
            <div role="alert" className="space-y-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] text-content-1">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" />
                <span>
                  <b>Last GRN post not confirmed</b> ({gateErrorMessage(ctx.uncertain.error)}). Submitting again resends the <b>identical</b> GRN with the same
                  token, so stock cannot be added twice. Edits made since are not included.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/inventory/gate-bills/${bill.id}`} target="_blank" className="inline-flex min-h-[36px] items-center rounded-lg border border-line bg-surface-1 px-3 text-[12px] font-semibold">
                  Check bill in new tab
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Only discard if the bill shows this GRN was NOT linked. Discard the unconfirmed post?")) ctx.discardPending();
                  }}
                  className="min-h-[36px] rounded-lg px-3 text-[12px] font-semibold text-content-3 underline"
                >
                  Verified not posted — discard
                </button>
              </div>
            </div>
          ) : null}
          {ctx.lastLinked?.billId === bill.id ? (
            <div role="status" className="space-y-2 rounded-xl border border-success-border bg-success-bg px-3 py-2.5 text-[13px] text-success-fg">
              <div className="font-semibold">
                {ctx.lastLinked.grn} linked to bill {billRef(bill.id)}
                {ctx.lastLinked.status ? ` · ${BILL_STATUS_META[ctx.lastLinked.status as keyof typeof BILL_STATUS_META]?.label ?? ctx.lastLinked.status}` : ""}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/inventory/gate-bills/${bill.id}`} className="inline-flex min-h-[40px] items-center rounded-xl bg-surface-1 px-3 text-[12.5px] font-semibold text-content-1">
                  Back to bill
                </Link>
                <Link href="/inventory/gate-bills" className="inline-flex min-h-[40px] items-center rounded-xl bg-surface-1 px-3 text-[12.5px] font-semibold text-content-1">
                  Gate bills queue
                </Link>
                <NextPendingLink currentId={bill.id} />
              </div>
              {ctx.lastLinked.status === "PARTIAL_GRN" ? (
                <div className="text-[12px] text-content-2">More lines on this bill? Post the next GRN below — it will link to the same bill.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export type { InwardBill };
