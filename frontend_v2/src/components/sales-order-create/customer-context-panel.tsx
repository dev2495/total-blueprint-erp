"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  History,
  Layers,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { salesService } from "@/services/sales";
import { api } from "@/lib/api";

interface Props {
  customerId: string;
  customerName?: string;
}

/**
 * Surfaces customer-side context once a customer is picked on Sales Create:
 * 1. Last 5 orders with status + total kg + a BOM peek
 * 2. Customer overlay summary (if any) — counts of pinned axes
 * 3. Repeat-lane hint — "Last run was 2-up. Use again?" The actual lane
 * control lives per-line on the order item.
 */
export function CustomerContextPanel({ customerId, customerName }: Props) {
  const ordersQuery = useQuery({
    queryKey: ["sales-orders-by-customer", customerId],
    queryFn: () => salesService.getOrders({ limit: 50 }),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  const overlaysQuery = useQuery({
    queryKey: ["customer-overlays", customerId],
    queryFn: async () => {
      try {
        const { data } = await api.get(
          "/api/master/customer-product-overlays/",
          {
            params: { customer: customerId, page_size: 50 },
          },
        );
        if (Array.isArray(data)) return data;
        if (data && Array.isArray((data as any).results))
          return (data as any).results;
        return [] as any[];
      } catch {
        return [] as any[];
      }
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });

  const customerOrders = (ordersQuery.data || [])
    .filter(
      (o: any) => String(o.customer_id || o.customer || "") === customerId,
    )
    .slice(0, 5);
  const overlays = (overlaysQuery.data as any[]) || [];

  const lastLaneCount = React.useMemo(() => {
    for (const o of customerOrders) {
      const items = (o as any).items || [];
      for (const it of items) {
        if (it.preferred_lane_count && it.preferred_lane_count > 0)
          return Number(it.preferred_lane_count);
      }
    }
    return null;
  }, [customerOrders]);

  if (!customerId) return null;

  return (
    <section className="rounded-[18px] border border-success-border bg-surface-1 p-3 shadow-sm">
      <header className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-success-fg text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div>
          <h3 className="font-display text-sm font-bold text-content-1">
            {customerName || "Customer"} · context
          </h3>
          <p className="text-[10px] text-content-3">
            Past orders, overlays + repeat-lane hints — pulled live for this
            customer.
          </p>
        </div>
      </header>

      <div className="grid gap-2">
        {/* Previous orders */}
        <div className="rounded-xl border border-line bg-surface-2 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-content-3">
            <History className="h-3 w-3" /> Recent orders
          </div>
          {ordersQuery.isLoading ? (
            <div className="mt-2 text-[11px] text-content-4">Loading…</div>
          ) : customerOrders.length === 0 ? (
            <div className="mt-2 text-[11px] text-content-3">
              No prior orders — first time for this customer.
            </div>
          ) : (
            <ul className="mt-2 space-y-1.5 text-[11px]">
              {customerOrders.map((o: any) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between rounded-md bg-surface-2 px-2 py-1.5 ring-1 ring-line"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/sales/orders/${o.id}`}
                      className="font-mono text-[11px] font-bold text-order-fg hover:underline"
                    >
                      {o.order_number || o.id?.slice(0, 8)}
                    </Link>
                    <div className="truncate text-[10px] text-content-3">
                      {(o.items || []).length} line
                      {(o.items || []).length === 1 ? "" : "s"} ·{" "}
                      {String(o.status || "").toLowerCase()}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-line text-[9px] text-content-3"
                  >
                    {o.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Overlays */}
        <div className="rounded-xl border border-line bg-surface-2 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-content-3">
            <Layers className="h-3 w-3" /> Customer overlays
          </div>
          {overlaysQuery.isLoading ? (
            <div className="mt-2 text-[11px] text-content-4">Loading…</div>
          ) : overlays.length === 0 ? (
            <div className="mt-2 text-[11px] text-content-3">
              No overlays defined for this customer.
            </div>
          ) : (
            <ul className="mt-2 space-y-1 text-[11px]">
              {overlays.slice(0, 4).map((ov: any, i: number) => (
                <li
                  key={i}
                  className="flex items-center gap-1 rounded-md bg-order-bg px-2 py-1 font-mono text-[10px] text-order-fg ring-1 ring-order-border"
                >
                  {ov.product_master_code ||
                    ov.product_master_name ||
                    "overlay"}
                </li>
              ))}
              {overlays.length > 4 ? (
                <div className="text-[10px] text-content-3">
                  +{overlays.length - 4} more
                </div>
              ) : null}
            </ul>
          )}
        </div>

        {/* Repeat lane hint */}
        <div
          className={cn(
            "rounded-xl p-2.5 ring-1",
            lastLaneCount
              ? "border-order-border bg-order-bg ring-order-border"
              : "border-line bg-surface-2 ring-line",
          )}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-order-fg">
            <Sparkles className="h-3 w-3" /> Repeat-lane hint
          </div>
          {lastLaneCount ? (
            <div className="mt-2 text-[12px] text-order-fg">
              Last run for this customer was <b>{lastLaneCount}-up</b>. The lane
              picker on each line will default to this.
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-content-3">
              No prior production for this customer · lane will default to{" "}
              <b>1-up</b>.
            </div>
          )}
          <div className="mt-2 text-[10px] text-content-4">
            Lane is captured per-line at the bottom of each line editor.
            Validated against the effective{" "}
            <Link
              href="/master/web-width-policies"
              className="font-bold text-order-fg underline"
            >
              web-width policy
            </Link>
            .
          </div>
        </div>
      </div>
    </section>
  );
}
