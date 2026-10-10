"use client";

import Link from "next/link";
import { ChevronRight, FileImage, Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";
import { CATEGORY_META, RECEIPT_KIND_LABEL, type DocumentCategory, type InwardBill } from "@/services/gate-bills";
import { BillThumb, SourceChip, StagePill, billDate, billDateTime, billRef, inr, waitingLabel } from "@/components/inventory/gate-bills/bill-common";

export function nextStepLabel(bill: InwardBill): string {
  if (bill.status === "VOID") return bill.needs_followup ? "Record what it delivered" : "Voided";
  if (bill.status === "FILED") return bill.attached_to ? `Attached to ${bill.attached_to.ref}` : "Filed";
  if (bill.status === "RECEIPTED") return "Received";
  if (!bill.category) return bill.status === "PARTIAL_GRN" ? "Classify, then confirm complete" : "Classify it";
  const route = CATEGORY_META[bill.category as DocumentCategory]?.route;
  if (bill.status === "PARTIAL_GRN") return "Confirm all lines received";
  return route === "grn" ? "Post GRN" : route === "jobwork" ? "Receive job work" : route === "general" ? "Create general receipt" : route === "attach" ? "Attach to stock bill or file" : "File it";
}

/** Card row used by the inbox and the register on small screens. */
export function DocumentRow({ bill, now }: { bill: InwardBill; now: number }) {
  const open = bill.status === "PENDING_GRN" || bill.status === "PARTIAL_GRN";
  const refs = bill.receipt_refs || [];
  const kinds = Array.from(new Set(refs.map((r) => RECEIPT_KIND_LABEL[r.kind] ?? r.kind)));
  const party = bill.party_display || bill.review_data?.vendor_name || "";
  return (
    <li>
      <Link
        href={`/inventory/gate-bills/${bill.id}`}
        className="flex min-h-[84px] items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info-border sm:px-4"
      >
        <BillThumb imageUrl={bill.pages?.[0]?.thumb_url ?? bill.pages?.[0]?.image_url} alt={`Bill ${billRef(bill.id)} page 1`} className="h-16 w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-[14px] font-semibold text-content-1">{party || "Party not entered"}</span>
            <StagePill bill={bill} />
            <SourceChip source={bill.source} />
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-content-3">
            {bill.source === "OFFICE" ? "Uploaded" : "Arrived"} {billDateTime(bill.arrival_at)} · {bill.plant_name} · <span className="font-mono">{billRef(bill.id)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-content-2">
            {bill.invoice_number ? <span className="font-mono">Inv {bill.invoice_number}</span> : null}
            {bill.invoice_date ? <span>{billDate(bill.invoice_date)}</span> : null}
            {bill.total_amount ? <span className="tabular-nums font-medium">{inr(bill.total_amount)}</span> : null}
            {bill.category_label ? <span>{bill.category_label}</span> : null}
            <span className="inline-flex items-center gap-1">
              <FileImage className="h-3.5 w-3.5 text-content-4" aria-hidden />
              {bill.page_count} page{bill.page_count === 1 ? "" : "s"}
            </span>
            {bill.supporting_documents?.length ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="h-3.5 w-3.5 text-content-4" aria-hidden />
                {bill.supporting_documents.length} attached
              </span>
            ) : null}
            {refs.length ? <span>{refs.length} receipt{refs.length === 1 ? "" : "s"} · {kinds.join(", ")}</span> : null}
            {bill.duplicate_warning?.possible_duplicate ? <span className="font-semibold text-warning-fg">Same photos uploaded before</span> : null}
          </div>
          <div className="mt-1 text-[12px] font-semibold text-primary">{nextStepLabel(bill)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-[15px] font-semibold tabular-nums", open ? "text-content-1" : "text-content-3")}>
            {waitingLabel(bill.arrival_at, now, open ? null : bill.resolved_at)}
          </div>
          <div className="text-[11px] text-content-4">{open ? "waiting" : "to close"}</div>
        </div>
        <ChevronRight className="hidden h-5 w-5 shrink-0 text-content-4 sm:block" aria-hidden />
      </Link>
    </li>
  );
}
