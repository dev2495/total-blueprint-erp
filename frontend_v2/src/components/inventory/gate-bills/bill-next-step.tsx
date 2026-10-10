"use client";

import Link from "next/link";
import { ClipboardCheck, FileArchive, Link2, PackagePlus, Paperclip, ReceiptText, Truck } from "lucide-react";

import { Panel } from "@/components/premium";
import { cn } from "@/lib/utils";
import { BILL_STATUS_META, CATEGORY_META, FILEABLE_DOC_TYPES, VOID_CODE_LABEL, type BillAction, type DocumentCategory, type DocumentType, type InwardBill } from "@/services/gate-bills";
import { billDateTime } from "./bill-common";

export type DialogKind = "match" | "complete" | "void" | "file" | "attach" | "reopen" | "detach";

const primaryClass =
  "flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border aria-disabled:pointer-events-none aria-disabled:opacity-50";
const secondaryClass =
  "flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-1 px-4 text-[14px] font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

function ActionLink({ href, children, disabled, secondary }: { href: string; children: React.ReactNode; disabled?: boolean; secondary?: boolean }) {
  return (
    <Link href={href} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} className={secondary ? secondaryClass : primaryClass}>
      {children}
    </Link>
  );
}

function ActionButton({ onClick, children, secondary, tone }: { onClick: () => void; children: React.ReactNode; secondary?: boolean; tone?: "good" }) {
  return (
    <button type="button" onClick={onClick} className={cn(secondary ? secondaryClass : primaryClass, tone === "good" ? "border-success-border bg-success-bg text-success-fg" : "")}>
      {children}
    </button>
  );
}

/** One primary action chosen by category (SPEC §3.2), plus the matching secondary ones. */
export function NextStepCard({ bill, headerDirty, onDialog }: { bill: InwardBill; headerDirty: boolean; onDialog: (kind: DialogKind) => void }) {
  const can = (action: BillAction) => Boolean(bill.allowed_actions?.includes(action));
  const open = bill.status === "PENDING_GRN" || bill.status === "PARTIAL_GRN";
  const refs = bill.receipt_refs ?? [];

  if (!open) {
    return (
      <Panel title={BILL_STATUS_META[bill.status]?.label ?? "Closed"} description={BILL_STATUS_META[bill.status]?.hint}>
        <div className="space-y-2 text-[13px] text-content-2">
          <div>
            {bill.status === "RECEIPTED" ? "All lines received" : bill.status === "FILED" ? "Filed as a record" : "Voided"} · {billDateTime(bill.resolved_at)}
            {bill.resolved_by_name ? ` · by ${bill.resolved_by_name}` : ""}
          </div>
          {bill.status === "VOID" && bill.resolution_code ? <div className="text-content-3">Reason code: {VOID_CODE_LABEL[bill.resolution_code] ?? bill.resolution_code}</div> : null}
          {bill.resolution_reason ? <div className="rounded-xl bg-surface-2 px-3 py-2 text-content-2">“{bill.resolution_reason}”</div> : null}
          {bill.followup ? (
            <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-content-1">
              Followed up by general receipt{" "}
              <Link href={`/inventory/general-receipts/${bill.followup.id}`} className="font-mono font-semibold text-primary hover:underline">{bill.followup.number}</Link>. The original void stays in the history.
            </div>
          ) : null}
          {bill.needs_followup ? (
            <div className="space-y-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-content-1">
              <p>This bill was voided as “non-stock” under the old rule, so nothing records what it delivered. Record a General Receipt for it — the void stays as it is.</p>
              {can("followup") ? (
                <ActionLink href={`/inventory/general-receipts/new?followup=${bill.id}`}>
                  <ReceiptText className="h-4 w-4" /> Create general receipt from this bill
                </ActionLink>
              ) : (
                <p className="text-[12px] text-content-3">Ask an account with the documents manage right to record it.</p>
              )}
            </div>
          ) : null}
          {can("reopen") || can("detach") ? <p className="text-[12px] text-content-4">Owners and administrators can correct this from “More actions”.</p> : null}
        </div>
      </Panel>
    );
  }

  const category = (bill.category || "") as DocumentCategory | "";
  const route = category ? CATEGORY_META[category].route : null;
  const fileable = can("file");
  const noteFileable = fileable && route !== "file" && FILEABLE_DOC_TYPES.includes(bill.doc_type as DocumentType);
  const vendorParam = bill.vendor ? `&vendor=${bill.vendor}` : "";
  const hold = headerDirty;

  return (
    <Panel title="Next step" description={category ? CATEGORY_META[category].next : "Choose a category above — the next step appears here."}>
      <div className="space-y-2">
        {hold ? <p role="status" className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[13px] font-medium text-content-1">Save or discard the changed details first, so the next screen uses them.</p> : null}

        {bill.status === "PARTIAL_GRN" && can("complete") ? (
          <ActionButton onClick={() => onDialog("complete")} tone="good">
            <ClipboardCheck className="h-4 w-4" /> Confirm all lines received
          </ActionButton>
        ) : null}

        {route === "grn" ? (
          can("grn") ? (
            <ActionLink href={`/inventory/grn?inward_bill_id=${bill.id}`} disabled={hold} secondary={bill.status === "PARTIAL_GRN"}>
              <PackagePlus className="h-4 w-4" /> {refs.length ? "Post another GRN for this bill" : "Open GRN"}
            </ActionLink>
          ) : (
            <p className="text-[13px] text-content-3">Posting a GRN needs inventory receiving rights. An Inventory (Store) user can post it from this bill.</p>
          )
        ) : null}

        {route === "jobwork" ? (
          can("jobwork") ? (
            <ActionLink href={`/inventory/job-work?bill=${bill.id}${vendorParam}`} disabled={hold} secondary={bill.status === "PARTIAL_GRN"}>
              <Truck className="h-4 w-4" /> Receive job work
            </ActionLink>
          ) : (
            <p className="text-[13px] text-content-3">Receiving job work needs inventory receiving rights.</p>
          )
        ) : null}

        {route === "general" && can("general_receipt") ? (
          <ActionLink href={`/inventory/general-receipts/new?bill=${bill.id}`} disabled={hold} secondary={bill.status === "PARTIAL_GRN"}>
            <ReceiptText className="h-4 w-4" /> {refs.length ? "Add another general receipt" : "Create general receipt"}
          </ActionLink>
        ) : null}

        {route === "attach" && can("attach") ? (
          <ActionButton onClick={() => onDialog("attach")}>
            <Paperclip className="h-4 w-4" /> Attach to the stock bill
          </ActionButton>
        ) : null}

        {(route === "file" || route === "attach") && fileable ? (
          <ActionButton onClick={() => onDialog("file")} secondary={route === "attach"}>
            <FileArchive className="h-4 w-4" /> File as record
          </ActionButton>
        ) : null}

        {noteFileable ? (
          <ActionButton onClick={() => onDialog("file")} secondary>
            <FileArchive className="h-4 w-4" /> File as record (no goods with this {bill.doc_type_label?.toLowerCase() || "paper"})
          </ActionButton>
        ) : null}

        {!category && can("grn") ? (
          <ActionLink href={`/inventory/grn?inward_bill_id=${bill.id}`} disabled={hold} secondary>
            <PackagePlus className="h-4 w-4" /> It is a stock bill — open GRN directly
          </ActionLink>
        ) : null}

        {can("link_receipts") ? (
          <ActionButton onClick={() => onDialog("match")} secondary>
            <Link2 className="h-4 w-4" /> Match an existing receipt
          </ActionButton>
        ) : null}

        {!bill.allowed_actions?.some((a) => a !== "view" && a !== "download_original") ? (
          <p className="text-[13px] text-content-3">You can view this document. Classifying, receiving and filing need the documents manage right.</p>
        ) : null}
        <p className="pt-1 text-[12px] leading-relaxed text-content-4">
          Only stock items post inventory. A receipt keeps the bill “Partly received” until someone confirms every line on the paper is in.
        </p>
      </div>
    </Panel>
  );
}
