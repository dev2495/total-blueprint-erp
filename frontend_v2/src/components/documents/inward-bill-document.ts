import { billDateTime, billRef } from "@/components/inventory/gate-bills/bill-common";
import { BILL_STATUS_META, type InwardBill } from "@/services/gate-bills";

import type { WorkspaceDocument, WorkspaceTone } from "./bill-workspace-shared";

const TONE: Record<string, WorkspaceTone> = { warn: "warning", info: "info", good: "success", neutral: "neutral" };

/** `<BillWorkspace>` document for an inward (gate / office) bill. */
export function inwardBillDocument(bill: InwardBill): WorkspaceDocument {
  const meta = BILL_STATUS_META[bill.status as keyof typeof BILL_STATUS_META];
  // Header fields added by the documents register (party / vendor) when present.
  const header = bill as InwardBill & { party_name?: string | null; vendor_name?: string | null };
  const party = header.party_name || header.vendor_name || bill.review_data?.vendor_name || "";
  const pages = bill.pages ?? [];
  return {
    id: bill.id,
    label: `Bill ${billRef(bill.id)}${party ? ` · ${party}` : ""}`,
    statusLabel: meta?.label ?? String(bill.status || ""),
    statusTone: TONE[meta?.tone ?? "neutral"] ?? "neutral",
    meta: [`Arrived ${billDateTime(bill.arrival_at)}`, bill.plant_name, `${pages.length} page${pages.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
    pages,
    popoutHref: `/inventory/gate-bills/${bill.id}/view`,
  };
}
