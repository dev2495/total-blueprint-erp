"use client";

import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { canReviewGateBills } from "@/components/gate/gate-access";
import { gateBillsApi } from "@/services/gate-bills";

/** Shared entry point for inventory pages; unresolved counts are never unread counts. */
export function GateBillInboxLink() {
  const { user, effectiveRole } = useAuth();
  const allowed = canReviewGateBills(user, effectiveRole);
  const summary = useQuery({
    queryKey: ["notifications", "inward-bill-summary", user?.id, effectiveRole, allowed],
    queryFn: () => gateBillsApi.summary(),
    enabled: allowed,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    meta: { suppressGlobalError: true },
  });
  if (!allowed) return null;

  return (
    <Link href="/inventory/gate-bills" data-testid="inventory-gate-bills-link" className="flex min-h-16 flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-1 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-bg text-warning-fg"><Inbox className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-content-1">Gate bills waiting for inventory</span>
        <span className="block text-[12px] leading-relaxed text-content-3">{summary.isError ? "Could not refresh the count. Open the queue to retry." : "Review photos, record GRNs and confirm every bill line."}</span>
      </span>
      <span className="flex items-center gap-2 text-content-1"><span className="text-[24px] font-semibold tabular-nums">{summary.data?.pending_count ?? "—"}</span><ArrowUpRight className="h-4 w-4 text-content-3" /></span>
    </Link>
  );
}
