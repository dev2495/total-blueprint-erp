"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileStack, PackagePlus, ReceiptText, UploadCloud } from "lucide-react";

import { PageHero } from "@/components/premium";
import { cn } from "@/lib/utils";
import { gateBillsApi } from "@/services/gate-bills";
import { BILL_POLL_MS, BillAccessDenied, useDocumentAccess } from "@/components/inventory/gate-bills/bill-common";
import { InboxTab } from "./inbox-tab";
import { RegisterTable } from "./register-table";
import { ReportsTab } from "./reports-tab";
import { UploadBillDialog } from "./upload-dialog";

type TabKey = "inbox" | "all" | "filed" | "followups" | "reports";

/**
 * /inventory/gate-bills — Bills & documents: one register for every paper the
 * factory receives (gate photos and office uploads). Classify → receive (GRN,
 * job work, general receipt) or file. Only stock items post inventory.
 */
export function DocumentsRegisterPage() {
  const access = useDocumentAccess();
  const router = useRouter();
  const pathname = usePathname() || "/inventory/gate-bills";
  const params = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);
  const tabs: Array<{ key: TabKey; label: string; show: boolean }> = [
    { key: "inbox", label: "Inbox", show: true },
    { key: "all", label: "All documents", show: true },
    { key: "filed", label: "Filed", show: true },
    { key: "followups", label: "Non-stock follow-ups", show: access.manage },
    { key: "reports", label: "Reports", show: true },
  ];
  const visible = tabs.filter((t) => t.show);
  const requested = (params?.get("tab") || "inbox") as TabKey;
  const tab: TabKey = visible.some((t) => t.key === requested) ? requested : "inbox";
  const setTab = (next: TabKey) => {
    const query = new URLSearchParams(params?.toString() ?? "");
    if (next === "inbox") query.delete("tab");
    else query.set("tab", next);
    router.replace(`${pathname}${query.toString() ? `?${query}` : ""}`, { scroll: false });
  };

  const summaryQ = useQuery({
    queryKey: ["inventory", "gate-bills", "summary"],
    queryFn: () => gateBillsApi.summary(),
    enabled: access.view,
    refetchInterval: BILL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />;
  if (!access.view) return <BillAccessDenied />;
  const s = summaryQ.data;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="documents-register">
      <PageHero
        eyebrow="Inventory · bills & documents"
        icon={<FileStack />}
        title="Bills & documents"
        description="Every bill the factory receives — photographed at the gate or uploaded at the office. Classify each one: stock goes to a GRN, job work to its order, spares / machinery / services to a General Receipt, and everything else is filed as a record."
        actions={
          <div className="flex flex-wrap gap-2">
            {access.upload ? (
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-semibold text-content-1 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <UploadCloud className="h-4 w-4" /> Upload bill
              </button>
            ) : null}
            <Link href="/inventory/general-receipts" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/15">
              <ReceiptText className="h-4 w-4" /> General receipts
            </Link>
            {access.review ? (
              <Link href="/inventory/grn" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/15">
                <PackagePlus className="h-4 w-4" /> Smart GRN
              </Link>
            ) : null}
          </div>
        }
        compact
      >
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-white/80" aria-live="polite">
          <span><span className="text-[22px] font-semibold tabular-nums text-white">{s?.needs_classifying ?? "—"}</span> need classifying</span>
          <span><span className="text-[22px] font-semibold tabular-nums text-white">{s?.waiting_receipt ?? "—"}</span> waiting for receipt</span>
          <span><span className="text-[22px] font-semibold tabular-nums text-white">{s?.partial_count ?? "—"}</span> partly received</span>
          {s?.unread_count ? <span>{s.unread_count} new gate alert{s.unread_count === 1 ? "" : "s"}</span> : null}
          {summaryQ.isError ? <span role="status">Counts could not refresh — the last confirmed counts are shown.</span> : null}
        </div>
      </PageHero>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Bills & documents views">
        {visible.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`docs-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`docs-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : delta ? (i + delta + visible.length) % visible.length : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(visible[next].key);
                (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
              }}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
                active ? "border-transparent bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <section role="tabpanel" id={`docs-panel-${tab}`} aria-labelledby={`docs-tab-${tab}`}>
        {tab === "inbox" ? <InboxTab /> : null}
        {tab === "all" ? <RegisterTable mode="ALL" /> : null}
        {tab === "filed" ? <RegisterTable mode="FILED" /> : null}
        {tab === "followups" ? <RegisterTable mode="FOLLOWUP" /> : null}
        {tab === "reports" ? <ReportsTab showStorage={access.master} /> : null}
      </section>

      {access.upload ? <UploadBillDialog open={uploadOpen} onClose={() => setUploadOpen(false)} /> : null}
    </div>
  );
}
