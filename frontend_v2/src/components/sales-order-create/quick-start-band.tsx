"use client";

/**
 * V3.4 Sales Order — Quick Start band.
 *
 * After customer is picked, surface their recent orders + saved presets +
 * customer overlays as click-to-clone cards. Each "+ Add line" click drops a
 * fully-filled line into the cart.
 *
 * Live sources:
 * - last_orders: salesService.getRecentOrders() filtered by customer
 * - overlay_default: customer Product Master overlays filtered by customer
 * - presets: intentionally hidden until a real saved-preset endpoint exists
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Repeat, Sparkles, Star, UserSquare, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { salesService } from "@/services/sales";
import {
  productMasterService,
  type CustomerProductOverlay,
  type ProductMaster,
} from "@/services/product-master";
import type { QuickStartCard, SalesOrderLine } from "./types";
import { formatDisplayDate } from "@/lib/date-format";

export interface QuickStartBandProps {
  customerId: string;
  customerName?: string;
  masters: ProductMaster[];
  onAdd: (seed: Partial<SalesOrderLine>) => void;
}

export function QuickStartBand({
  customerId,
  customerName,
  masters,
  onAdd,
}: QuickStartBandProps) {
  const { data: recent = [] } = useQuery({
    queryKey: ["recent-orders", customerId],
    queryFn: salesService.getRecentOrders,
    enabled: !!customerId,
    staleTime: 30_000,
  });
  const { data: overlays = [] } = useQuery({
    queryKey: ["customer-product-overlays", customerId],
    queryFn: () =>
      productMasterService.listCustomerOverlays({
        customer: customerId,
        active: true,
      }),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  const cards = React.useMemo<QuickStartCard[]>(() => {
    if (!customerId) return [];
    const out: QuickStartCard[] = [];

    for (const overlay of overlays.slice(0, 6)) {
      const m = masters.find((x) => x.id === overlay.product_master);
      if (!m) continue;
      const axisValues = overlay.axis_values || {};
      const sizeCode = String(
        axisValues.size || overlay.size_variant_code || "",
      );
      if (!sizeCode || Number(m.sizes_count || 0) <= 0) continue;
      const catalogAxisValues = Object.fromEntries(
        Object.entries(axisValues).filter(
          ([key]) =>
            ![
              "size",
              "layer_thicknesses",
              "layer_grades",
              "layer_widths",
              "addons",
            ].includes(key),
        ),
      );
      out.push({
        id: `overlay-${overlay.id}`,
        kind: "overlay_default",
        title:
          overlay.customer_item_code ||
          `${m.code}${sizeCode ? ` · ${sizeCode}` : ""}`,
        subtitle: overlay.customer_display_name || m.name,
        metric: [
          sizeCode || "all sizes",
          overlay.default_artwork_design_code
            ? `art ${overlay.default_artwork_design_code}`
            : null,
          overlay.default_price_basis
            ? `per ${overlay.default_price_basis}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        badge: "default",
        seed: overlayToLineSeed(overlay, catalogAxisValues, sizeCode),
      });
    }

    // Last orders for THIS customer (dedupe by master + size + axis_signature).
    const seen = new Set<string>();
    const customerOrders = (recent || []).filter(
      (o: any) => o.customer === customerId || o.customer_id === customerId,
    );
    for (const order of customerOrders) {
      for (const item of order.items || []) {
        const masterId = item.product_master || item.product_master_id;
        const m = masters.find((x) => x.id === masterId);
        if (!m) continue;
        const sizeCode = String(item.axis_values?.size || "");
        if (!sizeCode || Number(m.sizes_count || 0) <= 0) continue;
        const sig = `${masterId}|${item.axis_values?.size || ""}|${(item.axis_values?.addons || []).join(",")}|${item.axis_values?.pod_variant || ""}|${item.axis_values?.packaging_inner || ""}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        const placedDate = order.created_at ? new Date(order.created_at) : null;
        out.push({
          id: `recent-${order.id}-${item.id || sig}`,
          kind: "last_order",
          title: `${m.code} · ${item.axis_values?.size || "—"}`,
          subtitle: m.name,
          metric: placedDate
            ? `${formatDisplayDate(placedDate)} · ${item.qty_value || ""} ${item.qty_uom || ""}`.trim()
            : `${item.qty_value || ""} ${item.qty_uom || ""}`.trim(),
          badge: "recent",
          seed: {
            product_master: masterId || undefined,
            size_code: item.axis_values?.size || "",
            addons: item.axis_values?.addons || [],
            axis_values: {
              ...(item.axis_values?.pod_variant
                ? { pod_variant: item.axis_values.pod_variant }
                : {}),
              ...(item.axis_values?.packaging_inner
                ? { packaging_inner: item.axis_values.packaging_inner }
                : {}),
              ...(item.axis_values?.packaging_outer
                ? { packaging_outer: item.axis_values.packaging_outer }
                : {}),
            },
            qty_value: Number(item.qty_value || 1000),
            qty_uom: (item.qty_uom || "KG") as "KG" | "PCS",
            unit_price: String(item.unit_price || "0.00"),
            price_basis: (item.price_basis || "KG") as "KG" | "PCS",
          },
        });
        if (out.length >= 5) break;
      }
      if (out.length >= 5) break;
    }

    return out;
  }, [customerId, overlays, recent, masters]);

  if (!customerId) return null;

  if (cards.length === 0) {
    return (
      <div
        className="rounded-2xl border border-line bg-gradient-to-br from-surface-2 to-white p-4 shadow-sm"
        data-testid="sales-quick-start-band"
      >
        <div className="flex items-center gap-2 text-[11px] font-bold text-content-2">
          <Sparkles className="h-3.5 w-3.5 text-content-3" />
          Quick Start
          <span
            className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-content-3"
            data-testid="sales-quick-start-empty"
          >
            no overlays or recent activity
          </span>
        </div>
        <p className="mt-1.5 text-xs text-content-3">
          {customerName
            ? `${customerName} has no customer defaults or recent order shortcuts yet. `
            : ""}
          Add a line manually below; once an overlay or repeat order exists it
          will show here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="sales-quick-start-band">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gradient-to-r from-order-bg to-order-bg px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-order-fg ring-1 ring-order-border">
            <Zap className="-mt-0.5 mr-1 inline h-2.5 w-2.5" />
            Quick Start
          </span>
          {customerName && (
            <span className="text-[11px] font-medium text-content-3">
              for{" "}
              <span className="font-bold text-content-2">{customerName}</span>
            </span>
          )}
        </div>
        <span className="text-[10px] font-bold text-content-3">
          {cards.length} suggestion{cards.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <QuickStartCardView key={c.id} card={c} onAdd={() => onAdd(c.seed)} />
        ))}
      </div>
    </div>
  );
}

function overlayToLineSeed(
  overlay: CustomerProductOverlay,
  catalogAxisValues: Record<string, any>,
  sizeCode: string,
): Partial<SalesOrderLine> {
  const axisValues = overlay.axis_values || {};
  const addons = Array.isArray(axisValues.addons)
    ? axisValues.addons.map((item) => String(item))
    : [];
  return {
    product_master: overlay.product_master,
    customer_product_overlay: overlay.id,
    size_code: sizeCode,
    addons,
    axis_values: catalogAxisValues,
    artwork_mode: overlay.default_artwork ? "OVERLAY_DEFAULT" : "DEFER",
    qty_value: Number(overlay.moq_kg || 1000),
    qty_uom: "KG",
    unit_price: "0.00",
    price_basis: overlay.default_price_basis || "KG",
    remarks: overlay.default_packing_note || overlay.notes || "",
  };
}

function QuickStartCardView({
  card,
  onAdd,
}: {
  card: QuickStartCard;
  onAdd: () => void;
}) {
  const tone = TONE[card.kind];
  return (
    <button
      type="button"
      onClick={onAdd}
      data-testid={`sales-quick-start-card-${card.kind}`}
      className={cn(
        "group relative flex flex-col gap-2 overflow-hidden rounded-2xl border bg-surface-1 p-4 text-left shadow-sm ring-1 transition hover:shadow-md hover:ring-2",
        tone.border,
        tone.ring,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg ring-1 shadow-sm",
              tone.iconBg,
              tone.iconText,
              tone.iconRing,
            )}
          >
            {tone.icon}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1 ring-inset",
              tone.badgeBg,
              tone.badgeText,
            )}
          >
            {tone.label}
          </span>
        </div>
        <span className="rounded-full bg-primary p-1 text-white shadow-md transition group-hover:bg-primary group-hover:shadow-lg">
          <Plus className="h-3 w-3" />
        </span>
      </div>
      <div>
        <div className="font-mono text-xs font-bold text-content-1">
          {card.title}
        </div>
        {card.subtitle && (
          <div className="mt-0.5 truncate text-[11px] text-content-3">
            {card.subtitle}
          </div>
        )}
      </div>
      {card.metric && (
        <div className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-content-2">
          {card.metric}
        </div>
      )}
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-content-4 group-hover:text-primary">
        + Add to cart
      </div>
    </button>
  );
}

const TONE: Record<QuickStartCard["kind"], any> = {
  last_order: {
    icon: <Repeat className="h-3.5 w-3.5" />,
    label: "Last order",
    border: "border-info-border",
    ring: "ring-info-border hover:ring-info-border",
    iconBg: "bg-info-bg",
    iconText: "text-primary",
    iconRing: "ring-info-border",
    badgeBg: "bg-info-bg",
    badgeText: "text-primary",
  },
  preset: {
    icon: <Star className="h-3.5 w-3.5" />,
    label: "Saved preset",
    border: "border-order-border",
    ring: "ring-order-border hover:ring-order-border",
    iconBg: "bg-order-bg",
    iconText: "text-order-fg",
    iconRing: "ring-order-border",
    badgeBg: "bg-order-bg",
    badgeText: "text-order-fg",
  },
  overlay_default: {
    icon: <UserSquare className="h-3.5 w-3.5" />,
    label: "Customer default",
    border: "border-success-border",
    ring: "ring-success-border hover:ring-success-border",
    iconBg: "bg-success-bg",
    iconText: "text-success-fg",
    iconRing: "ring-success-border",
    badgeBg: "bg-success-bg",
    badgeText: "text-success-fg",
  },
};
