"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, ClipboardList, FileText, History, PackageCheck, Printer, Scissors, Send, Truck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { BillWorkspace } from "@/components/documents/bill-workspace";
import { inwardBillDocument } from "@/components/documents/inward-bill-document";
import { PageHero, Panel, PanelEmpty } from "@/components/premium";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { gateBillsApi } from "@/services/gate-bills";
import { jobWorkApi, type JobWorkOrderDetail, type JobWorkReturnDoc } from "@/services/job-work";

import { CloseDialog, type CloseKind } from "./close-dialogs";
import { DispatchDialog } from "./dispatch-dialog";
import { Chip, ErrorBanner, fmtDate, fmtDateTime, fmtInr, fmtKg, fmtNum, JobWorkAccessDenied, JobWorkStatusPill, jobWorkError, Notice, toNumber, useJobWorkAccess } from "./job-work-common";

const RATE = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
import { ReceivePanel } from "./receive-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETURN_LINE_LABEL: Record<string, string> = {
  FG_PCS: "Finished pieces",
  OUTPUT_ROLL: "Output roll",
  OUTPUT_BULK: "Bulk output",
  BALANCE_ROLL: "Balance roll back",
  BALANCE_BULK: "Balance back",
  WASTAGE: "Wastage",
};

export function JobWorkDetail({ id }: { id: string }) {
  const access = useJobWorkAccess();
  const router = useRouter();
  const params = useSearchParams();
  const billParam = params?.get("bill") ?? "";
  const billId = UUID.test(billParam) ? billParam : "";
  const [receiving, setReceiving] = useState(Boolean(billId) || params?.get("receive") === "1");
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [closeKind, setCloseKind] = useState<CloseKind | null>(null);
  useEffect(() => {
    if (billId) setReceiving(true);
  }, [billId]);

  const orderQ = useQuery({
    queryKey: ["jobwork", "detail", id],
    queryFn: () => jobWorkApi.get(id),
    enabled: access.canView && UUID.test(id),
    refetchOnWindowFocus: !receiving,
    meta: { suppressGlobalError: true },
  });
  const billQ = useQuery({
    queryKey: ["inventory", "gate-bills", "detail", billId],
    queryFn: () => gateBillsApi.get(billId),
    enabled: Boolean(billId) && access.canLinkBill,
    retry: false,
    meta: { suppressGlobalError: true },
  });
  const billDoc = useMemo(() => (billQ.data ? inwardBillDocument(billQ.data) : null), [billQ.data]);

  const printChallan = async (url: string) => {
    const win = window.open("", "_blank");
    try {
      const objectUrl = await jobWorkApi.pdfObjectUrl(url);
      if (win) win.location.href = objectUrl;
      else window.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      win?.close();
      toast.error(jobWorkError(error, "The challan PDF could not open."));
    }
  };

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!access.canView) return <JobWorkAccessDenied />;
  if (!UUID.test(id)) return <ErrorBanner message="This link does not point to a job-work order." />;
  if (orderQ.isError) {
    const status = getApiErrorStatus(orderQ.error);
    return (
      <div className="mx-auto max-w-[900px] space-y-3">
        <ErrorBanner message={status === 404 ? "This job-work order does not exist." : jobWorkError(orderQ.error, "The order could not load.")} onRetry={status === 404 ? undefined : () => void orderQ.refetch()} />
        <Link href="/inventory/job-work" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> All job work
        </Link>
      </div>
    );
  }
  if (orderQ.isLoading || !orderQ.data) return <div className="mx-auto h-64 max-w-[1400px] animate-pulse rounded-3xl bg-surface-2" />;
  const order = orderQ.data;

  if (receiving && order.actions.can_receive) {
    const billBlocked = Boolean(billId) && (!access.canLinkBill || billQ.isError);
    const billClosed = billQ.data && !["PENDING_GRN", "PARTIAL_GRN"].includes(String(billQ.data.status));
    const leave = () => {
      setReceiving(false);
      if (billId || params?.get("receive")) router.replace(`/inventory/job-work/${order.id}`);
    };
    return (
      <BillWorkspace document={billId ? billDoc : null}>
        <div className="mx-auto max-w-[1100px] space-y-3">
          <button type="button" onClick={leave} className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-primary">
            <ArrowLeft className="h-4 w-4" /> {order.number}
          </button>
          {billBlocked ? (
            <Notice tone="bad" title="The bill cannot be linked">
              {access.canLinkBill ? jobWorkError(billQ.error, "The bill could not load.") : "Linking bills needs bill-receiving rights."} Receive without the bill from the order page, or reopen it from Bills &amp; documents.
            </Notice>
          ) : billClosed ? (
            <Notice tone="bad" title="This bill is already closed">Open it from Bills &amp; documents to see what it is linked to.</Notice>
          ) : billId && billQ.isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
          ) : (
            <ReceivePanel order={order} bill={billId ? billQ.data ?? null : null} onCancel={leave} onDone={leave} />
          )}
        </div>
      </BillWorkspace>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="jobwork-detail">
      <Link href="/inventory/job-work" className="inline-flex min-h-[40px] items-center gap-2 text-sm font-semibold text-primary">
        <ArrowLeft className="h-4 w-4" /> All job work
      </Link>
      <PageHero
        eyebrow={`Job work · ${order.mode === "PLANNED_STEP" ? "planned route step" : "emergency handoff"}`}
        icon={<Truck />}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{order.number}</span>
            <JobWorkStatusPill status={order.status} className="bg-white/90" />
          </span>
        }
        description={`${order.vendor_name}${order.vendor?.gst_no ? ` (GSTIN ${order.vendor.gst_no})` : ""} · ${order.plant_name}${order.process ? ` · ${order.process.name}` : ""}`}
        meta={
          <>
            {order.overdue ? <Chip tone="bad">Overdue</Chip> : null}
            {order.at_vendor.itc04_alert ? <Chip tone="warn">Material 300+ days at vendor (ITC-04)</Chip> : null}
            {order.is_legacy ? <Chip>Created before the upgrade</Chip> : null}
          </>
        }
        actions={
          order.permissions.can_manage ? (
            <div className="flex flex-wrap gap-2">
              {order.actions.can_dispatch ? (
                <Button type="button" variant="secondary" onClick={() => setDispatchOpen(true)} className="min-h-[44px]" data-testid="jobwork-dispatch">
                  <Send /> Send material
                </Button>
              ) : null}
              {order.actions.can_receive ? (
                <Button type="button" onClick={() => setReceiving(true)} className="min-h-[44px]" data-testid="jobwork-receive">
                  <PackageCheck /> Receive
                </Button>
              ) : null}
              {order.actions.can_close ? (
                <Button type="button" variant="success" onClick={() => setCloseKind("close")} className="min-h-[44px]">
                  <CheckCircle2 /> Close
                </Button>
              ) : null}
              {order.actions.can_short_close ? (
                <Button type="button" variant="outline" onClick={() => setCloseKind("short-close")} className="min-h-[44px]">
                  <Scissors /> Close short
                </Button>
              ) : null}
              {order.actions.can_cancel ? (
                <Button type="button" variant="outline" onClick={() => setCloseKind("cancel")} className="min-h-[44px]">
                  <Ban /> Cancel draft
                </Button>
              ) : null}
            </div>
          ) : null
        }
        compact
      />

      {order.legacy.stuck_rolls ? (
        <Notice tone="warn" title={`${order.legacy.stuck_rolls} roll(s) from before the upgrade are still recorded at ${order.vendor_name} (${fmtKg(order.legacy.stuck_kg)})`}>
          They must be settled before this order can receive, send or close.{" "}
          {order.permissions.can_reconcile ? (
            <Link href="/inventory/job-work?tab=LEGACY" className="font-semibold underline">
              Reconcile them
            </Link>
          ) : (
            "Ask an owner to reconcile them."
          )}
        </Notice>
      ) : null}
      {billId && !order.actions.can_receive ? (
        <Notice tone="warn" title="This order cannot receive the bill's return">
          {order.number} is {order.status_label.toLowerCase()}. Pick another open order for this job worker from{" "}
          <Link href={`/inventory/job-work?bill=${billId}`} className="font-semibold underline">
            the bill&apos;s order list
          </Link>
          .
        </Notice>
      ) : null}
      {!order.permissions.can_manage ? <Notice tone="info">You can view this order. Sending, receiving and closing need inventory manage rights.</Notice> : null}
      {order.status === "RETURNED" && order.actions.can_close ? <Notice tone="good">Everything sent is settled. Close the order to finish{order.mode === "PLANNED_STEP" ? " and complete the route step" : ""}.</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Order" icon={<ClipboardList />} className="lg:col-span-2" bodyClassName="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <Fact label="Production job">
            {order.production_job ? (
              <>
                <span className="font-mono font-semibold">{order.production_job.job_number}</span> · {order.production_job.job_state.toLowerCase()}
                {order.production_job.is_on_hold ? " · on hold" : ""}
                {order.production_job.sales_order_number ? ` · ${order.production_job.sales_order_number}` : ""}
              </>
            ) : (
              "None (emergency handoff)"
            )}
          </Fact>
          <Fact label="Expected output">
            {order.expected_output_label}
            {order.expected_qty ? ` · ${fmtNum(order.expected_qty)} ${order.expected_uom}` : ""}
          </Fact>
          <Fact label="Agreed rate">
            {order.rate ? `₹${RATE.format(toNumber(order.rate))} per ${order.rate_uom.toLowerCase()}` : "Not set"}
            {order.vendor_rate && order.rate && (toNumber(order.vendor_rate.rate) !== toNumber(order.rate) || order.vendor_rate.uom !== order.rate_uom) ? (
              <span className="text-warning-fg"> · rate card ₹{RATE.format(toNumber(order.vendor_rate.rate))} per {order.vendor_rate.uom.toLowerCase()}</span>
            ) : null}
          </Fact>
          <Fact label="Expected back by">{fmtDate(order.expected_return_date)}</Fact>
          <Fact label="Balance tolerance">{order.wastage_tolerance_pct}%</Fact>
          <Fact label="Created">{fmtDateTime(order.created_at)}{order.created_by_name ? ` by ${order.created_by_name}` : ""}</Fact>
          {order.emergency_reason ? <Fact label="Emergency reason">{order.emergency_reason}</Fact> : null}
          {order.notes ? <Fact label="Notes">{order.notes}</Fact> : null}
          {order.closed_at ? <Fact label={order.status === "CANCELLED" ? "Cancelled" : "Closed"}>{fmtDateTime(order.closed_at)}{order.closed_by_name ? ` by ${order.closed_by_name}` : ""}</Fact> : null}
          {order.short_close_reason ? <Fact label="Closed short because">{order.short_close_reason}</Fact> : null}
          {order.cancel_reason ? <Fact label="Cancelled because">{order.cancel_reason}</Fact> : null}
        </Panel>
        <Panel title="At the job worker" icon={<AlertTriangle />} bodyClassName="space-y-2 text-[13px]">
          <div className="text-[28px] font-semibold tabular-nums text-content-1">{fmtKg(order.at_vendor.kg)}</div>
          <div className="text-content-3">
            {order.at_vendor.lines} open line{order.at_vendor.lines === 1 ? "" : "s"} ({order.at_vendor.rolls} roll{order.at_vendor.rolls === 1 ? "" : "s"}) · {fmtInr(order.at_vendor.value)}
          </div>
          {order.at_vendor.oldest_sent_at ? <div className="text-content-3">Oldest sent {fmtDate(order.at_vendor.oldest_sent_at)} · {order.at_vendor.oldest_days} days ago</div> : null}
          <div className="grid grid-cols-2 gap-2 border-t border-line pt-2">
            <Mini label="Sent" value={fmtKg(order.totals.sent_kg)} />
            <Mini label="Output" value={order.totals.output_pcs ? `${fmtNum(order.totals.output_pcs)} pcs · ${fmtKg(order.totals.output_kg)}` : fmtKg(order.totals.output_kg)} />
            <Mini label="Balance back" value={fmtKg(order.totals.balance_kg)} />
            <Mini label="Wastage" value={fmtKg(order.totals.wastage_kg)} />
            <Mini label="Unexplained" value={`${fmtKg(order.totals.variance_kg)}${order.totals.variance_pct !== null ? ` (${order.totals.variance_pct}%)` : ""}`} tone={order.totals.variance_pct !== null && Math.abs(Number(order.totals.variance_pct)) > Number(order.totals.tolerance_pct) ? "bad" : undefined} />
            {Number(order.totals.written_off_kg) > 0 ? <Mini label="Written off" value={fmtKg(order.totals.written_off_kg)} tone="bad" /> : null}
          </div>
        </Panel>
      </div>

      <Panel title="Challans" icon={<FileText />} description="Each dispatch issues a job-work delivery challan (GST Rule 45) with a QR the gate scans." bodyClassName="space-y-3">
        {order.challans.length ? (
          order.challans.map((challan) => (
            <div key={challan.id} className="rounded-xl border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                <div className="text-[13px]">
                  <span className="font-mono font-semibold">{challan.number}</span> · {fmtDateTime(challan.issued_at)}
                  {challan.issued_by_name ? ` · ${challan.issued_by_name}` : ""} · {fmtKg(challan.total_qty_kg)} · {fmtInr(challan.total_value)}
                  {challan.gate_out_at ? <Chip tone="good">Left gate {fmtDateTime(challan.gate_out_at)}</Chip> : <Chip>Not scanned at gate</Chip>}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void printChallan(challan.pdf_url)}>
                  <Printer /> Print challan
                </Button>
              </div>
              <SentLines lines={challan.lines} />
            </div>
          ))
        ) : (
          <PanelEmpty icon={<Send />} title="Nothing sent yet">{order.actions.can_dispatch ? "Use Send material to pick rolls and issue the challan." : "Material goes out on a challan from this page."}</PanelEmpty>
        )}
        {order.sent_lines.some((line) => line.is_legacy) ? (
          <div className="rounded-xl border border-line">
            <div className="border-b border-line px-3 py-2 text-[13px] font-semibold">Sent before the upgrade (reconciled)</div>
            <SentLines lines={order.sent_lines.filter((line) => line.is_legacy)} />
          </div>
        ) : null}
      </Panel>

      <Panel title="Returns" icon={<PackageCheck />} bodyClassName="space-y-3">
        {order.returns.length ? order.returns.map((ret) => <ReturnCard key={ret.id} ret={ret} />) : <PanelEmpty icon={<PackageCheck />} title="Nothing received back yet" />}
      </Panel>

      <Panel title="Timeline" icon={<History />}>
        <ol className="space-y-2">
          {order.timeline.map((event, index) => (
            <li key={index} className="flex gap-3 text-[13px]">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-content-3" aria-hidden />
              <span>
                <span className="font-semibold text-content-1">{event.label}</span> · {fmtDateTime(event.at)}
                {event.actor_name ? ` · ${event.actor_name}` : ""}
                {event.reason ? <span className="block text-content-3">{event.reason}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      {order.permissions.can_manage ? (
        <>
          <DispatchDialog order={order} open={dispatchOpen} onOpenChange={setDispatchOpen} onPrint={(url) => void printChallan(url)} />
          <CloseDialog order={order} kind={closeKind} onOpenChange={setCloseKind} />
        </>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] font-medium text-content-3">{label}</div>
      <div className="text-content-1">{children}</div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div>
      <div className="text-[11.5px] text-content-3">{label}</div>
      <div className={cn("font-semibold tabular-nums", tone === "bad" ? "text-danger-fg" : "text-content-1")}>{value}</div>
    </div>
  );
}

function SentLines({ lines }: { lines: JobWorkOrderDetail["sent_lines"] }) {
  return (
    <ul className="divide-y divide-line">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
          <span className="min-w-0">
            <span className="font-semibold text-content-1">{line.kind === "ROLL" ? <span className="font-mono">{line.roll_label}</span> : line.material_name}</span> · {line.description}
            {line.hsn_code ? <span className="text-content-3"> · HSN {line.hsn_code}</span> : null}
          </span>
          <span className="flex items-center gap-2 tabular-nums">
            {fmtNum(line.quantity)} {line.uom} · {fmtInr(line.value)}
            {line.is_open ? <Chip tone={line.itc04_alert ? "warn" : "info"}>At vendor{line.age_days !== null ? ` · ${line.age_days} d` : ""}</Chip> : <Chip tone="good">Settled</Chip>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReturnCard({ ret }: { ret: JobWorkReturnDoc }) {
  const off = ret.variance_pct !== null && Math.abs(Number(ret.variance_pct)) > 0.05;
  return (
    <div className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-[13px]">
        <span>
          <span className="font-mono font-semibold">{ret.number}</span> · {fmtDateTime(ret.received_at)}
          {ret.received_by_name ? ` · ${ret.received_by_name}` : ""}
          {ret.vendor_document_no ? ` · vendor doc ${ret.vendor_document_no}` : ""}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {ret.bill ? (
            <Link href={`/inventory/gate-bills/${ret.bill.id}`} className="text-[12px] font-semibold text-primary hover:underline">
              Bill {ret.bill.id.slice(0, 8).toUpperCase()} · {ret.bill.status.replace("_", " ").toLowerCase()}
            </Link>
          ) : null}
          {ret.billed_amount ? <Chip tone="info">Billed {fmtInr(ret.billed_amount)}</Chip> : null}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {ret.lines.map((line) => (
          <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
            <span className="min-w-0">
              <span className="font-semibold text-content-1">{RETURN_LINE_LABEL[line.kind] || line.kind}</span>
              {line.fg_batch_number ? <span className="font-mono"> · {line.fg_batch_number}</span> : null}
              {line.roll_label ? <span className="font-mono"> · {line.roll_label}</span> : null}
              {line.material_name && line.kind !== "FG_PCS" ? ` · ${line.material_name}` : ""}
              {line.location_name ? <span className="text-content-3"> · {line.location_name}</span> : null}
              {line.boxes ? ` · ${line.boxes} boxes` : ""}
              {line.bags ? ` · ${line.bags} bags` : ""}
              {line.kind === "WASTAGE" ? ` · ${line.returned_to_factory ? "returned to factory" : "kept by job worker"}` : ""}
            </span>
            <span className="tabular-nums">
              {line.uom === "PCS" ? `${fmtNum(line.quantity)} pcs · ${fmtKg(line.qty_kg)}` : `${fmtNum(line.quantity)} ${line.uom}`}
            </span>
          </li>
        ))}
      </ul>
      <div className={cn("border-t border-line px-3 py-2 text-[12px]", off ? "text-warning-fg" : "text-content-3")}>
        Settled {fmtKg(ret.settled_sent_kg)} = output {fmtKg(ret.output_kg)} + balance {fmtKg(ret.balance_kg)} + wastage {fmtKg(ret.wastage_kg)}; difference {fmtKg(ret.variance_kg)}
        {ret.variance_pct !== null ? ` (${ret.variance_pct}%)` : ""}
        {ret.variance_reason ? ` — ${ret.variance_reason}` : ""}
      </div>
      {ret.warnings.length ? (
        <ul className="space-y-1 border-t border-line bg-warning-bg px-3 py-2 text-[12px] text-warning-fg">
          {ret.warnings.map((warning, index) => (
            <li key={index}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
