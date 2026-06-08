"use client";

// Sales order create workspace shell with customer header, line builder, and sticky submit.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  Loader2,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { masterDataService, type Customer } from "@/services/master-data";
import { productMasterService } from "@/services/product-master";
import { salesService } from "@/services/sales";

import { useSalesDraft } from "./use-sales-draft";
import { Cart } from "./cart";
import { QuickStartBand } from "./quick-start-band";
import { CustomerContextPanel } from "./customer-context-panel";
import { buildSalesAxisValues } from "./axis-values";
import { INP, MONO, SoField, SoSelect } from "./ui";

export function SalesOrderV34Workspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const initialMaster =
    searchParams?.get("product_master") || searchParams?.get("master") || "";
  const initialCustomer = searchParams?.get("customer") || "";

  const draftHook = useSalesDraft(initialCustomer);
  const {
    draft,
    setCustomer,
    setShipTo,
    setAddressOverride,
    setOrderName,
    setDeliveryDate,
    setRemarks,
    addLine,
    removeLine,
    duplicateLine,
    updateLine,
    expandLine,
    cartTotalKg,
    cartTotalValue,
    blockingIssues,
    warnings,
  } = draftHook;

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: masterDataService.getCustomers,
    staleTime: 60_000,
  });
  const { data: masters = [], isSuccess: mastersReady } = useQuery({
    queryKey: ["product-masters", "v34"],
    queryFn: () => productMasterService.list({ for_sales: true }),
    staleTime: 30_000,
  });

  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    if (initialMaster && draft.lines.length === 0 && mastersReady) {
      seededRef.current = true;
      const currentMaster = masters.find((x) => x.id === initialMaster);
      if (currentMaster) {
        addLine({ product_master: initialMaster });
      } else {
        toast({
          title: "Product master unavailable",
          description:
            "That link points to an inactive or old Product Master version. Pick the current version from the catalog.",
          variant: "destructive",
        });
      }
    }
  }, [
    initialMaster,
    draft.lines.length,
    addLine,
    masters,
    mastersReady,
    toast,
  ]);

  const customer = customers.find((c) => c.id === draft.customer);
  const axisBlockingIssues = React.useMemo(() => {
    const issues: string[] = [];
    draft.lines.forEach((line, index) => {
      const master = masters.find((x) => x.id === line.product_master);
      if (line.product_master && !master) {
        issues.push(
          `Line ${index + 1}: product master is inactive, old version, or unavailable`,
        );
        return;
      }
      buildSalesAxisValues(master, line).missingLabels.forEach((label) => {
        issues.push(`Line ${index + 1}: ${label}`);
      });
      (line.pre_submit_blockers || []).forEach((label) => {
        if (label) issues.push(`Line ${index + 1}: ${label}`);
      });
    });
    return issues;
  }, [draft.lines, masters]);
  const combinedBlockingIssues = React.useMemo(
    () => uniqueStrings([...blockingIssues, ...axisBlockingIssues]),
    [blockingIssues, axisBlockingIssues],
  );
  const combinedReadyToSubmit = combinedBlockingIssues.length === 0;

  const createMutation = useMutation({
    mutationFn: () => {
      if (axisBlockingIssues.length > 0) {
        throw new Error(axisBlockingIssues[0]);
      }
      return salesService.createOrder({
        customer: draft.customer,
        ship_to_customer: draft.ship_to_customer || draft.customer,
        address_override: draft.address_override,
        order_name:
          draft.order_name || `Order ${new Date().toISOString().slice(0, 10)}`,
        delivery_date: draft.delivery_date,
        remarks: draft.remarks,
        items: draft.lines.map((line) => {
          const m = masters.find((x) => x.id === line.product_master);
          const axis_values = buildSalesAxisValues(m, line).axisValues;
          return {
            product_master: line.product_master,
            customer_product_overlay: line.customer_product_overlay,
            template_id: line.template_id,
            axis_values,
            qty_value: line.qty_value,
            qty_uom: line.qty_uom,
            preferred_lane_count: line.preferred_lane_count,
            lane_count_source: line.lane_count_source,
            packaging_snapshot: buildLinePackagingSnapshot(line),
            price_basis: line.price_basis,
            unit_price: line.unit_price,
            printing: m?.fixed_attributes?.print_capable
              ? {
                  enabled: true,
                  print_type: line.print_type,
                  film_type: line.film_type,
                  defer_artwork_to_planner: line.artwork_mode === "DEFER",
                  artwork_id:
                    line.artwork_mode === "DEFER"
                      ? null
                      : line.artwork_assignment?.artwork_id,
                  cylinder_required: line.print_type === "ROTO",
                }
              : { enabled: false },
            remarks: line.remarks,
          };
        }),
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Sales order sent to planner",
        description: `Order ${data?.order_number || data?.id || ""} · ${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"} · Planning queue`,
      });
      router.push("/sales/orders");
    },
    onError: (err: any) =>
      toast({
        title: "Could not create order",
        description: err?.message || "Try again",
        variant: "destructive",
      }),
  });
  const submitOrder = React.useCallback(() => {
    if (!combinedReadyToSubmit || createMutation.isPending) return;
    createMutation.mutate();
  }, [combinedReadyToSubmit, createMutation]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submitOrder();
        return;
      }
      if (
        event.altKey &&
        key === "n" &&
        draft.customer &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        addLine();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addLine, draft.customer, submitOrder]);

  const perLineIssues = React.useMemo(() => {
    const out: Record<string, string[]> = {};
    draft.lines.forEach((l) => {
      const issues: string[] = [];
      if (!l.product_master) issues.push("Missing product master");
      const master = masters.find((x) => x.id === l.product_master);
      if (l.product_master && !master)
        issues.push("Product master is inactive, old version, or unavailable");
      if (l.product_master && !l.size_code) issues.push("Missing size");
      if (l.qty_value <= 0) issues.push("Quantity must be > 0");
      if (master) issues.push(...buildSalesAxisValues(master, l).missingLabels);
      (l.pre_submit_blockers || []).forEach((issue) => {
        if (issue) issues.push(issue);
      });
      if (issues.length) out[l.id] = issues;
    });
    return out;
  }, [draft.lines, masters]);

  return (
    <div
      className="mx-auto max-w-[1600px] space-y-3 pb-32"
      data-testid="sales-order-v34-workspace"
    >
      <SubtleHero
        customer={customer}
        customerCount={customers.length}
        draft={draft}
        cartTotalKg={cartTotalKg}
        cartTotalValue={cartTotalValue}
        isReady={combinedReadyToSubmit}
        blockerCount={combinedBlockingIssues.length}
      />

      <CustomerHeaderStrip
        customers={customers}
        draft={draft}
        customer={customer}
        onSetCustomer={setCustomer}
        onSetShipTo={setShipTo}
        onSetAddressOverride={setAddressOverride}
        onSetOrderName={setOrderName}
        onSetDeliveryDate={setDeliveryDate}
      />

      {draft.customer ? (
        <details className="group rounded-[18px] border border-line bg-surface-1 shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[11px] font-bold text-content-3">
            <Sparkles className="h-3.5 w-3.5 text-order-fg" />
            Quick start · repeat orders · customer overlays
            <span className="ml-auto text-[10px] font-bold text-content-4 group-open:hidden">
              expand
            </span>
            <span className="ml-auto hidden text-[10px] font-bold text-content-4 group-open:inline">
              collapse
            </span>
          </summary>
          <div className="grid gap-3 border-t border-line p-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <QuickStartBand
              customerId={draft.customer}
              customerName={customer?.name}
              masters={masters}
              onAdd={(seed) => addLine(seed)}
            />
            <CustomerContextPanel
              customerId={draft.customer}
              customerName={customer?.name}
            />
          </div>
        </details>
      ) : null}

      <section className="grid gap-3">
        <Cart
          draft={draft}
          masters={masters}
          onAddLine={() => addLine()}
          onRemoveLine={removeLine}
          onDuplicateLine={duplicateLine}
          onUpdateLine={updateLine}
          onExpandLine={expandLine}
          perLineIssues={perLineIssues}
        />
      </section>

      {draft.lines.length > 0 ? (
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
              Order remarks (optional)
            </Label>
            <Textarea
              value={draft.remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Special instructions for the whole order. Per-line notes live inside the line editor."
              className="mt-1 min-h-[72px] rounded-xl border-line shadow-sm"
            />
          </div>
          <BlockerPanel
            blockingIssues={combinedBlockingIssues}
            warnings={warnings}
            isReady={combinedReadyToSubmit}
          />
        </section>
      ) : null}

      <StickyCartBar
        lineCount={draft.lines.length}
        cartTotalKg={cartTotalKg}
        cartTotalValue={cartTotalValue}
        blockingIssues={combinedBlockingIssues}
        warnings={warnings}
        isReady={combinedReadyToSubmit}
        isSubmitting={createMutation.isPending}
        onSubmit={submitOrder}
      />
    </div>
  );
}

// ─── Subtle hero ─────────────────────────────────────────────────

function SubtleHero({
  customer,
  customerCount,
  draft,
  cartTotalKg,
  cartTotalValue,
  isReady,
  blockerCount,
}: {
  customer: Customer | undefined;
  customerCount: number;
  draft: any;
  cartTotalKg: number;
  cartTotalValue: number;
  isReady: boolean;
  blockerCount: number;
}) {
  return (
    <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-order-fg via-order-fg to-order-fg p-5 text-white shadow-2xl ">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(255,255,255,0.24),transparent_28rem)]" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-order-border">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-success-fg" />
            Sales Order · Create · Full Line Workspace
          </div>
          <h1 className="mt-1.5 font-display text-2xl font-black tracking-tight md:text-3xl">
            {customer
              ? `${customer.name} order workspace`
              : "Every field, organised for fast order entry"}
          </h1>
          <p className="mt-1 max-w-4xl text-sm font-semibold text-order-border">
            {customer
              ? "Customer header, overlay shortcuts, repeat lines, full product-master axes, artwork, packing, quantity and live BOM now sit in one tabbed build surface."
              : `Pick one of ${customerCount} customers to unlock overlays, repeat orders, and the line workspace.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black">
            <span
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full px-3 ring-1",
                customer
                  ? "bg-success-fg text-success-border ring-success-border"
                  : "bg-warning-fg text-warning-border ring-warning-border",
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Customer{" "}
              {customer ? "set" : "pending"}
            </span>
            <span className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-1/12 px-3 text-white ring-1 ring-surface-1/20">
              Lines{" "}
              <span className="font-mono tabular-nums">
                {draft.lines.length}
              </span>
            </span>
            <span className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-1/12 px-3 text-white ring-1 ring-surface-1/20">
              KG{" "}
              <span className="font-mono tabular-nums">
                {cartTotalKg ? cartTotalKg.toLocaleString() : "—"}
              </span>
            </span>
            {cartTotalValue > 0 ? (
              <span className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-1/12 px-3 text-white ring-1 ring-surface-1/20">
                Value{" "}
                <span className="font-mono tabular-nums">
                  ₹{Math.round(cartTotalValue).toLocaleString()}
                </span>
              </span>
            ) : null}
            <span
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full px-3 ring-1",
                isReady
                  ? "bg-success-fg text-success-border ring-success-border"
                  : blockerCount > 0
                    ? "bg-danger-fg text-danger-border ring-danger-border"
                    : "bg-warning-fg text-warning-border ring-warning-border",
              )}
            >
              {isReady
                ? "Ready"
                : `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
        <div className="hidden rounded-2xl bg-surface-1/12 p-3 ring-1 ring-surface-1/20 backdrop-blur md:block">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-order-border">
            Flow
          </div>
          <div className="mt-2 grid gap-1 text-xs font-bold">
            <span>1. Header</span>
            <span>2. Line tabs</span>
            <span>3. Axes + artwork</span>
            <span>4. BOM + blockers</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Customer header strip ───────────────────────────────────────

function CustomerHeaderStrip({
  customers,
  draft,
  customer,
  onSetCustomer,
  onSetShipTo,
  onSetAddressOverride,
  onSetOrderName,
  onSetDeliveryDate,
}: {
  customers: Customer[];
  draft: any;
  customer: Customer | undefined;
  onSetCustomer: (v: string) => void;
  onSetShipTo: (v: string) => void;
  onSetAddressOverride: (v: string) => void;
  onSetOrderName: (v: string) => void;
  onSetDeliveryDate: (v: string) => void;
}) {
  const savedShipAddress = shipToAddress(customers, draft, customer);
  return (
    <section className="rounded-[18px] border border-line bg-surface-1 p-3 shadow-sm">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-6">
        <SoField label="Bill to · customer" className="md:col-span-2">
          <div className="relative">
            <select
              data-testid="sales-batch-customer"
              aria-label="Customer"
              value={draft.customer}
              onChange={(e) => onSetCustomer(e.target.value)}
              className={cn(INP, "cursor-pointer appearance-none pr-8")}
            >
              {!draft.customer ? (
                <option value="">Pick a customer</option>
              ) : null}
              {customers.map((c: Customer) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path
                d="M6 8l4 4 4-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          {customer ? (
            <div className="mt-1 truncate font-mono text-[10px] font-bold text-content-3">
              {customer.code || "—"}
              {customer.gst_no ? ` · GST ${customer.gst_no}` : ""}
            </div>
          ) : null}
        </SoField>
        <SoField label="Ship to">
          <SoSelect
            aria-label="Ship to"
            value={draft.ship_to_customer || "__same"}
            onChange={(v) => onSetShipTo(v === "__same" ? "" : v)}
          >
            <option value="__same">Same as customer</option>
            {customers.map((c: Customer) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SoSelect>
        </SoField>
        <SoField label="Order name">
          <input
            value={draft.order_name}
            onChange={(e) => onSetOrderName(e.target.value)}
            placeholder="e.g. ABC May order"
            className={INP}
          />
        </SoField>
        <SoField label="Promised dispatch">
          <input
            type="date"
            value={draft.delivery_date}
            onChange={(e) => onSetDeliveryDate(e.target.value)}
            className={cn(INP, MONO)}
          />
        </SoField>
        <SoField label="Plant">
          <div
            className={cn(
              INP,
              "flex items-center gap-2 bg-surface-2 text-content-3",
            )}
          >
            <Factory className="h-3.5 w-3.5 text-content-4" /> Auto · planner
          </div>
        </SoField>
      </div>

      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)]">
        <SoField
          label="Ship address"
          hint="editable · blank uses saved address"
        >
          <textarea
            value={draft.address_override}
            onChange={(e) => onSetAddressOverride(e.target.value)}
            placeholder={
              savedShipAddress || "Type the ship-to address manually"
            }
            className={cn(
              INP,
              "h-[66px] resize-none py-2 text-[12px] font-semibold leading-5",
            )}
          />
          <div className="mt-1 truncate text-[10px] font-semibold text-content-3">
            Saved ship address:{" "}
            {savedShipAddress || "not set for selected customer"}
          </div>
        </SoField>
      </div>

      {customer ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
          <span className="rounded-full bg-success-bg px-2 py-0.5 text-success-fg ring-1 ring-success-border">
            customer · {customer.name}
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-content-2 ring-1 ring-line">
            price basis · KG (default)
          </span>
          <span className="rounded-full bg-order-bg px-2 py-0.5 text-order-fg ring-1 ring-order-border">
            overlays resolved on save
          </span>
        </div>
      ) : null}
    </section>
  );
}

function shipToAddress(customers: Customer[], draft: any, customer?: Customer) {
  const shipTo =
    customers.find((c) => c.id === draft.ship_to_customer) || customer;
  return shipTo?.shipping_address || shipTo?.billing_address || "";
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function buildLinePackagingSnapshot(line: any) {
  const pcsPerPack = Number(line.inner_pouch_pcs_per_pack || 0);
  if (!Number.isFinite(pcsPerPack) || pcsPerPack <= 0) return undefined;
  return {
    primary_inner_pack: {
      enabled: true,
      pcs_per_pack: Math.floor(pcsPerPack),
      basis: "PCS_PER_PACK",
    },
  };
}

function BlockerPanel({
  blockingIssues,
  warnings,
  isReady,
}: {
  blockingIssues: string[];
  warnings: string[];
  isReady: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-[18px] border p-4 shadow-sm",
        isReady
          ? "border-success-border bg-success-bg"
          : "border-danger-border bg-danger-bg",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-xl text-white",
            isReady ? "bg-success-fg" : "bg-danger-solid",
          )}
        >
          {isReady ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
        </span>
        <div>
          <div
            className={cn(
              "text-[10px] font-black uppercase tracking-[0.2em]",
              isReady ? "text-success-fg" : "text-danger-fg",
            )}
          >
            {isReady ? "Ready to send" : "Submit blockers"}
          </div>
          <div className="text-sm font-black text-content-1">
            {isReady
              ? "BOM and order checks are clear"
              : `${blockingIssues.length} item${blockingIssues.length === 1 ? "" : "s"} need attention`}
          </div>
        </div>
      </div>
      {blockingIssues.length ? (
        <ul className="mt-3 space-y-1.5 text-xs font-bold text-danger-fg">
          {blockingIssues.slice(0, 5).map((issue, index) => (
            <li
              key={`${issue}-${index}`}
              className="rounded-lg bg-surface-1/80 px-2.5 py-1.5 ring-1 ring-danger-border"
            >
              {issue}
            </li>
          ))}
          {blockingIssues.length > 5 ? (
            <li className="px-2.5 text-[11px] text-danger-fg">
              + {blockingIssues.length - 5} more blockers in the sticky bar
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="mt-3 rounded-lg bg-surface-1/80 px-2.5 py-2 text-xs font-bold text-success-fg ring-1 ring-success-border">
          Customer, line axes, quantity, artwork/ink guards, packing and BOM
          requirements are clear.
        </div>
      )}
      {warnings.length ? (
        <div className="mt-2 rounded-lg bg-warning-bg px-2.5 py-2 text-xs font-bold text-warning-fg ring-1 ring-warning-border">
          {warnings[0]}
        </div>
      ) : null}
    </section>
  );
}

// ─── Sticky cart bar ─────────────────────────────────────────────

function StickyCartBar({
  lineCount,
  cartTotalKg,
  cartTotalValue,
  blockingIssues,
  warnings,
  isReady,
  isSubmitting,
  onSubmit,
}: {
  lineCount: number;
  cartTotalKg: number;
  cartTotalValue: number;
  blockingIssues: string[];
  warnings: string[];
  isReady: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-1/95 px-4 py-3 shadow-2xl backdrop-blur sm:px-6 lg:left-[var(--sidebar-width,16rem)]">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
              Cart
            </span>
            <span className="rounded-full bg-info-bg px-2.5 py-0.5 text-xs font-bold text-primary">
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
            {cartTotalKg > 0 ? (
              <span className="rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-bold text-success-fg ring-1 ring-success-border">
                {cartTotalKg.toLocaleString()} KG
              </span>
            ) : null}
            {cartTotalValue > 0 ? (
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-content-2">
                ₹{Math.round(cartTotalValue).toLocaleString()}
              </span>
            ) : null}
          </div>
          {blockingIssues.length > 0 || warnings.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {blockingIssues.slice(0, 2).map((b, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 font-bold text-danger-fg ring-1 ring-danger-border"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {b}
                </span>
              ))}
              {blockingIssues.length > 2 ? (
                <span className="text-danger-fg">
                  + {blockingIssues.length - 2} more
                </span>
              ) : null}
              {warnings.slice(0, 1).map((w, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 font-bold text-warning-fg ring-1 ring-warning-border"
                >
                  <Sparkles className="h-3 w-3" />
                  {w}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="sales-create-submit"
            onClick={onSubmit}
            disabled={!isReady || isSubmitting}
            className={cn(
              "gap-1.5 rounded-xl shadow-lg",
              isReady
                ? "bg-gradient-to-r from-success-fg to-info-fg hover:shadow-xl hover:"
                : "bg-line",
            )}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClipboardCheck className="h-4 w-4" />
            )}
            Create + send to planner
            <span className="hidden rounded bg-surface-1/15 px-1.5 py-0.5 text-[10px] font-black sm:inline">
              ⌘↵
            </span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
