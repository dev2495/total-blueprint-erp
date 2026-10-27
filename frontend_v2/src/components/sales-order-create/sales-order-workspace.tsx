"use client";

// Sales order composer: customer and order facts on top, every line in one table with a
// keyboard quick-add row, a wide drawer that builds a line, and the place bar. What is sent to
// the planner is the same payload as before; only the way it is put together changed.

import Link from "next/link";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Factory,
  FileText,
  History,
  Keyboard,
  Layers,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Search,
  ShoppingCart,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { masterDataService, type Customer } from "@/services/master-data";
import { productMasterService, type ProductMaster } from "@/services/product-master";
import { salesService } from "@/services/sales";

import { useSalesDraft } from "./use-sales-draft";
import { LinesTable, QuickAddRow } from "./lines-table";
import { LineDrawer } from "./line-drawer";
import { QuickStartBand } from "./quick-start-band";
import { CustomerContextPanel } from "./customer-context-panel";
import { buildSalesAxisValues } from "./axis-values";
import { INP, LABEL, MONO, SoField, SoSelect } from "./ui";
import type { SalesOrderDraft, SalesOrderLine } from "./types";
import { ActionBar, Pill } from "@/components/plate/steps";

/** What the success screen shows; taken from the draft the moment the order is created. */
type PlacedOrder = {
  id: string;
  number: string;
  name: string;
  customerId: string;
  customerName: string;
  lines: { title: string; detail: string; value: number }[];
  kg: number;
  pcs: number;
  value: number;
  dispatch: string;
};

const SUB = "mt-1 truncate text-[11.5px] text-content-3";

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

function qtySummary(kg: number, pcs: number) {
  return [kg > 0 ? `${kg.toLocaleString("en-IN")} kg` : "", pcs > 0 ? `${pcs.toLocaleString("en-IN")} pcs` : ""].filter(Boolean).join(" + ");
}

function localDate(iso: string) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function dispatchHint(iso: string) {
  const target = localDate(iso);
  if (!target) return { text: "needed to place the order", late: true };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const day = target.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} ago · ${day}`, late: true };
  if (days === 0) return { text: `today · ${day}`, late: false };
  if (days === 1) return { text: `tomorrow · ${day}`, late: false };
  return { text: `in ${days} days · ${day}`, late: false };
}

function longDate(iso: string) {
  const target = localDate(iso);
  return target ? target.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "not set";
}

function clockTime(iso: string) {
  const at = iso ? new Date(iso) : null;
  return at && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
}

function focusTestId(testId: string) {
  const node = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  node?.scrollIntoView({ block: "center", behavior: "smooth" });
  node?.focus();
}

export function SalesOrderV34Workspace() {
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
    moveLine,
    restoreLine,
    savedDraft,
    resumeSavedDraft,
    discardSavedDraft,
    savedAt,
    reset,
    cartTotalKg,
    cartTotalValue,
    blockingIssues,
    warnings,
  } = draftHook;
  const [placed, setPlaced] = React.useState<PlacedOrder | null>(null);
  const dateRef = React.useRef<HTMLInputElement>(null);

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
            "That link points to a Product Master that is unavailable for order placement. Pick an order-ready Product Master from the catalog.",
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
  const cartTotalPcs = React.useMemo(
    () => draft.lines.reduce((sum, line) => sum + (line.qty_uom === "PCS" ? Number(line.qty_value) || 0 : 0), 0),
    [draft.lines],
  );
  const axisBlockingIssues = React.useMemo(() => {
    const issues: string[] = [];
    draft.lines.forEach((line, index) => {
      const master = masters.find((x) => x.id === line.product_master);
      if (line.product_master && !master) {
        issues.push(
          `Line ${index + 1}: product master is unavailable for order placement`,
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
        // The job name is optional: left empty, the order has none (no date filler).
        order_name: String(draft.order_name || "").trim(),
        delivery_date: draft.delivery_date,
        remarks: draft.remarks,
        items: draft.lines.map((line) => {
          const m = masters.find((x) => x.id === line.product_master);
          const axis_values = buildSalesAxisValues(m, line).axisValues;
          return {
            product_master: line.product_master,
            customer_product_overlay: line.customer_product_overlay,
            line_name: line.line_label || line.line_name,
            template_id: line.template_id,
            axis_values,
            qty_value: line.qty_value,
            qty_uom: line.qty_uom,
            preferred_lane_count: line.preferred_lane_count,
            lane_count_source: line.lane_count_source,
            packaging_snapshot: buildLinePackagingSnapshot(line),
            issue_policy_overrides: line.issue_policy_overrides || [],
            price_basis: line.price_basis,
            unit_price: line.unit_price,
            printing: m?.fixed_attributes?.print_capable
              ? {
                  enabled: true,
                  print_type: line.print_type,
                  film_type: line.film_type,
                  chemicals: buildLineChemistrySnapshot(m),
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
      setPlaced({
        id: String(data?.id || ""),
        number: String(data?.order_number || data?.id || ""),
        name: String(draft.order_name || "").trim(),
        customerId: draft.customer,
        customerName: customer?.name || "",
        lines: draft.lines.map((line, index) => {
          const m = masters.find((x) => x.id === line.product_master);
          const value = (parseFloat(line.unit_price || "0") || 0) * (Number(line.qty_value) || 0);
          return {
            title: m?.name || line.line_label || `Line ${index + 1}`,
            detail: [
              line.line_label || line.line_name || m?.code || "",
              `${Number(line.qty_value || 0).toLocaleString("en-IN")} ${line.qty_uom.toLowerCase()}`,
              m?.fixed_attributes?.print_capable ? (line.artwork_mode === "DEFER" ? "artwork later" : line.print_type.toLowerCase()) : "",
            ]
              .filter(Boolean)
              .join(" · "),
            value,
          };
        }),
        kg: cartTotalKg,
        pcs: cartTotalPcs,
        value: cartTotalValue,
        dispatch: draft.delivery_date,
      });
      // The order is placed: this draft is done and is not offered again.
      reset();
      window.scrollTo({ top: 0, behavior: "smooth" });
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
        issues.push("Product master is unavailable for order placement");
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

  const firstBlocker = combinedBlockingIssues[0];

  /** Removes a line and offers it back for a few seconds. */
  const removeWithUndo = React.useCallback(
    (id: string, keepDrawer = false) => {
      const index = draft.lines.findIndex((line) => line.id === id);
      const line = draft.lines[index];
      if (!line) return;
      const neighbour = draft.lines[index + 1] || draft.lines[index - 1];
      removeLine(id);
      if (keepDrawer && neighbour) expandLine(neighbour.id);
      const name = masters.find((m) => m.id === line.product_master)?.name || line.line_label || "Empty line";
      toast({
        title: `Line ${index + 1} removed`,
        description: name,
        action: (
          <ToastAction altText="Undo remove" onClick={() => restoreLine(line, index)}>
            Undo
          </ToastAction>
        ),
      });
    },
    [draft.lines, expandLine, masters, removeLine, restoreLine, toast],
  );

  /** "Fix" in the readiness list: open the line, or put the cursor where the fix goes. */
  const fixIssue = React.useCallback(
    (issue: string) => {
      const lineMatch = /^Line (\d+):/i.exec(issue);
      if (lineMatch) {
        const line = draft.lines[Number(lineMatch[1]) - 1];
        if (line) expandLine(line.id);
        return;
      }
      if (/dispatch date/i.test(issue)) {
        dateRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        dateRef.current?.focus();
      } else if (/customer/i.test(issue)) {
        focusTestId("sales-customer-search");
      } else {
        focusTestId("sales-add-line-search");
      }
    },
    [draft.lines, expandLine],
  );

  const readiness = (
    <ReadinessList
      blockingIssues={combinedBlockingIssues}
      warnings={warnings}
      isReady={combinedReadyToSubmit}
      onFix={fixIssue}
    />
  );

  if (placed) {
    return (
      <div className="sales-create-shell mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-4 pb-16" data-testid="sales-order-v34-workspace">
        <ComposerHeader title="Order placed" customerId={placed.customerId} />
        <PlacedScreen
          placed={placed}
          onNewForCustomer={() => {
            reset(placed.customerId);
            setPlaced(null);
          }}
          onNew={() => {
            reset();
            setPlaced(null);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="sales-create-shell mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-3.5 pb-36"
      data-testid="sales-order-v34-workspace"
    >
      <ComposerHeader
        title="New order"
        customer={customer}
        customerId={draft.customer}
        jobName={draft.order_name}
        savedAt={savedAt}
      />

      {draft.customer ? (
        <OrderFacts
          customers={customers}
          draft={draft}
          customer={customer}
          dateRef={dateRef}
          onSetCustomer={setCustomer}
          onSetShipTo={setShipTo}
          onSetAddressOverride={setAddressOverride}
          onSetOrderName={setOrderName}
          onSetDeliveryDate={setDeliveryDate}
          onSetRemarks={setRemarks}
        />
      ) : (
        <StartScreen
          customers={customers}
          draft={draft}
          savedDraft={savedDraft}
          onPick={setCustomer}
          onResume={resumeSavedDraft}
          onDiscard={discardSavedDraft}
        />
      )}

      <section
        className="rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]"
        data-testid="sales-lines-card"
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-content-1">
            Lines{" "}
            <span className="rounded-full bg-info-bg px-2 py-px text-[12px] font-semibold tabular-nums text-primary">
              {draft.lines.length}
            </span>
          </h2>
          <span className="hidden min-w-0 text-[12.5px] text-content-3 md:inline">
            The same line label carries into planner, WCM, packing and dispatch.
          </span>
          {draft.customer ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Add line"
              title="Add a blank line in the full editor (Alt N)"
              onClick={() => addLine()}
              className="ml-auto h-9 gap-1.5 rounded-[10px]"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add line
              <kbd aria-hidden className="ml-0.5 hidden rounded border border-line bg-surface-2 px-1 font-mono text-[10.5px] text-content-3 sm:inline">
                Alt N
              </kbd>
            </Button>
          ) : null}
        </header>
        <LinesTable
          lines={draft.lines}
          masters={masters}
          perLineIssues={perLineIssues}
          activeId={draft.expanded_line_id}
          onOpen={expandLine}
          onDuplicate={duplicateLine}
          onRemove={(id) => removeWithUndo(id)}
          onMove={moveLine}
          emptyHint={
            draft.customer
              ? undefined
              : "Pick the customer first, then add lines by product master code or name, or repeat their last order."
          }
          quickAdd={
            draft.customer ? (
              <QuickAddRow
                masters={masters}
                onAdd={(seed, openEditor) => {
                  addLine(seed);
                  if (!openEditor) expandLine(null);
                }}
              />
            ) : null
          }
        />
        {draft.customer ? (
          <div className="rounded-b-[18px] border-t border-line px-4 py-3 sm:px-5">
            <QuickStartBand
              customerId={draft.customer}
              customerName={customer?.name}
              masters={masters}
              onAdd={(seed) => addLine(seed)}
            />
          </div>
        ) : null}
      </section>

      {draft.customer ? (
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
                  combinedReadyToSubmit
                    ? "border-success-border bg-success-bg text-success-fg"
                    : "border-warning-border bg-warning-bg text-warning-fg",
                )}
                data-testid="sales-create-readiness-toggle"
              >
                {combinedReadyToSubmit ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]">Before you place</span>
                <span className="truncate">
                  {combinedReadyToSubmit
                    ? "all clear"
                    : `${combinedBlockingIssues.length} to fix · ${firstBlocker}`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-[min(480px,calc(100vw-2rem))] p-0">
              {readiness}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 text-[12.5px] font-medium text-content-2 transition-colors hover:border-line-strong hover:text-content-1"
                data-testid="sales-quick-start-toggle"
              >
                <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-content-3">Customer</span>
                <span className="truncate">recent orders · saved items · last run</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="max-h-[min(560px,calc(100dvh-8rem))] w-[min(560px,calc(100vw-2rem))] p-3">
              <CustomerContextPanel customerId={draft.customer} customerName={customer?.name} />
            </PopoverContent>
          </Popover>
          <span className="ml-auto hidden text-[12px] text-content-4 sm:inline">
            Drafts autosave in this browser · ⌘↵ places the order
          </span>
        </div>
      ) : null}

      <LineDrawer
        lines={draft.lines}
        activeId={draft.expanded_line_id}
        masters={masters}
        customerId={draft.customer}
        perLineIssues={perLineIssues}
        onSelect={expandLine}
        onClose={() => expandLine(null)}
        onPatch={updateLine}
        onAdd={() => addLine()}
        onRemove={(id) => removeWithUndo(id, true)}
        onDuplicate={duplicateLine}
      />

      <StickyCartBar
        lineCount={draft.lines.length}
        cartTotalKg={cartTotalKg}
        cartTotalPcs={cartTotalPcs}
        cartTotalValue={cartTotalValue}
        blockingIssues={combinedBlockingIssues}
        warnings={warnings}
        isReady={combinedReadyToSubmit}
        isSubmitting={createMutation.isPending}
        onSubmit={submitOrder}
        customerId={draft.customer}
        firstMasterId={draft.lines[0]?.product_master || ""}
        firstBlocker={firstBlocker}
        readiness={readiness}
      />
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────

function ComposerHeader({
  title,
  customer,
  customerId,
  jobName,
  savedAt,
}: {
  title: string;
  customer?: Customer;
  customerId: string;
  jobName?: string;
  savedAt?: string;
}) {
  const quoteHref = customerId
    ? `/sales/quotations/new?customer=${encodeURIComponent(customerId)}`
    : "/sales/quotations/new";
  const saved = clockTime(savedAt || "");
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-2 pt-1">
      <div className="grid min-w-0 gap-0.5">
        <div className="text-[12.5px] font-medium text-content-3">Sales · New order</div>
        <h1 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-content-1">
          <span>{title}</span>
          {customer ? <span className="min-w-0 truncate font-medium text-content-3">· {customer.name}</span> : null}
          {jobName?.trim() ? (
            <span className="self-center rounded-full bg-info-bg px-2.5 py-0.5 text-[13px] font-medium tracking-normal text-primary">
              {jobName.trim()}
            </span>
          ) : null}
        </h1>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {saved ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-content-3" data-testid="sales-draft-saved">
            <span aria-hidden className="h-2 w-2 rounded-full bg-success-fg" />
            Draft saved {saved}
          </span>
        ) : null}
        <nav
          aria-label="Document kind"
          className="inline-flex h-10 items-center rounded-[12px] border border-line-strong bg-surface-2 p-1"
        >
          <span
            aria-current="page"
            className="inline-flex h-8 items-center gap-2 rounded-[9px] bg-plate px-3 text-[13px] font-semibold text-plate-fg"
          >
            <span className="font-mono text-[10.5px]">SO</span>Order
          </span>
          <Link
            href={quoteHref}
            className="inline-flex h-8 items-center gap-2 rounded-[9px] px-3 text-[13px] font-semibold text-content-3 transition hover:text-content-1"
            data-testid="sales-create-switch-quotation"
          >
            <span className="font-mono text-[10.5px]">QT</span>Quotation
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ─── Order facts (customer is set) ───────────────────────────────

function initials(name?: string) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] || "?").toUpperCase() + (words[1]?.[0] || "").toUpperCase();
}

function customerMeta(customer?: Customer) {
  if (!customer) return "";
  return [
    customer.code || "",
    customer.gst_no ? `GST ${customer.gst_no}` : "",
    customer.credit_days ? `${customer.credit_days} d credit` : "",
    "price basis kg by default",
  ]
    .filter(Boolean)
    .join(" · ");
}

function OrderFacts({
  customers,
  draft,
  customer,
  dateRef,
  onSetCustomer,
  onSetShipTo,
  onSetAddressOverride,
  onSetOrderName,
  onSetDeliveryDate,
  onSetRemarks,
}: {
  customers: Customer[];
  draft: SalesOrderDraft;
  customer: Customer | undefined;
  dateRef: React.RefObject<HTMLInputElement>;
  onSetCustomer: (v: string) => void;
  onSetShipTo: (v: string) => void;
  onSetAddressOverride: (v: string) => void;
  onSetOrderName: (v: string) => void;
  onSetDeliveryDate: (v: string) => void;
  onSetRemarks: (v: string) => void;
}) {
  const savedShipAddress = shipToAddress(customers, draft, customer);
  const due = dispatchHint(draft.delivery_date);
  const override = String(draft.address_override || "").trim();
  const remarks = String(draft.remarks || "").trim();
  return (
    <section
      className="grid items-start gap-x-3 gap-y-3 rounded-[18px] border border-line bg-surface-1 px-4 py-3 shadow-[var(--shadow-sm)] sm:grid-cols-2 sm:px-5 lg:grid-cols-4 min-[1340px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.95fr)]"
      data-testid="sales-order-facts"
    >
      <div
        className="relative -m-1 flex min-w-0 items-center gap-3 self-center rounded-[14px] p-1 transition-colors focus-within:ring-2 focus-within:ring-primary hover:bg-surface-2 sm:col-span-2 lg:col-span-2 min-[1340px]:col-span-1"
        title="Change the customer"
      >
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[11px] bg-plate text-[14px] font-semibold text-plate-fg">
          {initials(customer?.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15.5px] font-semibold tracking-[-0.01em] text-content-1">
            {customer?.name || "Customer"}
          </div>
          <div className="truncate font-mono text-[11.5px] text-content-3" title={customerMeta(customer)}>
            {customerMeta(customer) || "loading…"}
          </div>
        </div>
        <ChevronDown className="h-4 w-4 flex-none text-content-4" aria-hidden />
        {/* The native list stays the source of truth: keyboard and screen readers get a real select. */}
        <select
          data-testid="sales-batch-customer"
          aria-label="Customer"
          value={draft.customer}
          onChange={(e) => onSetCustomer(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {customers.map((c: Customer) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
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
      <SoField label="Promised dispatch">
        <input
          ref={dateRef}
          type="date"
          aria-label="Promised dispatch"
          value={draft.delivery_date}
          onChange={(e) => onSetDeliveryDate(e.target.value)}
          className={cn(INP, MONO, !draft.delivery_date && "border-warning-border")}
        />
        <div className={cn(SUB, due.late && "text-warning-fg")}>{due.text}</div>
      </SoField>
      <SoField label="Plant">
        <div
          className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-[11px] bg-surface-2 px-2.5 text-[13px] font-medium text-content-2"
          title="The planner picks the plant when it plans the order"
        >
          <Factory className="h-3.5 w-3.5 flex-none text-content-4" aria-hidden />
          Auto · planner
        </div>
        <div className={SUB}>picked when planned</div>
      </SoField>
      <SoField label="Job name">
        <input
          value={draft.order_name}
          onChange={(e) => onSetOrderName(e.target.value)}
          placeholder="e.g. ABC May order"
          aria-label="Job name"
          className={INP}
        />
        <div className={SUB}>optional · beside SO no.</div>
      </SoField>
      <SoField label="Ship address">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(INP, "flex items-center gap-2 text-left")}
              data-testid="sales-ship-address-toggle"
              title={override || savedShipAddress || "No saved address"}
            >
              <MapPin className="h-3.5 w-3.5 flex-none text-content-4" aria-hidden />
              <span className={cn("min-w-0 flex-1 truncate", !override && !savedShipAddress && "text-warning-fg")}>
                {override ? override : savedShipAddress ? `Saved · ${savedShipAddress}` : "Not set"}
              </span>
              <Pencil className="h-3.5 w-3.5 flex-none text-content-4" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-3">
            <div className={cn(LABEL, "mb-1.5")}>Ship address for this order</div>
            <textarea
              value={draft.address_override}
              onChange={(e) => onSetAddressOverride(e.target.value)}
              placeholder={savedShipAddress || "Type the ship-to address manually"}
              rows={3}
              aria-label="Ship address"
              className={cn(INP, "h-auto min-h-[76px] resize-y py-2 leading-5")}
            />
            <div className="mt-1.5 text-[12px] text-content-3">
              Saved ship address: {savedShipAddress || "not set for selected customer"}
            </div>
            {override ? (
              <button
                type="button"
                onClick={() => onSetAddressOverride("")}
                className="mt-2 text-[12.5px] font-semibold text-primary hover:underline"
              >
                Use the saved address
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
        <div className={SUB}>{override ? "typed for this order" : "blank uses the saved one"}</div>
      </SoField>
      <SoField label="Note for dispatch">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                INP,
                "flex items-center gap-2 text-left",
                remarks ? "" : "border-dashed text-content-3",
              )}
              data-testid="sales-dispatch-note-toggle"
              title={remarks || "Add a note for dispatch"}
            >
              <FileText className="h-3.5 w-3.5 flex-none text-content-4" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{remarks || "Add a note"}</span>
              {remarks ? <Pencil className="h-3.5 w-3.5 flex-none text-content-4" aria-hidden /> : <Plus className="h-3.5 w-3.5 flex-none text-content-4" aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(400px,calc(100vw-2rem))] p-3">
            <div className="text-[13.5px] font-semibold text-content-1">Note for dispatch</div>
            <div className="text-[12px] text-content-3">Client note · prints on the dispatch slip when written</div>
            <Textarea
              value={draft.remarks}
              onChange={(e) => onSetRemarks(e.target.value)}
              placeholder="What the customer asked for on delivery, e.g. 'Deliver before 11 am, call Ramesh at the gate'. Shown on the order page and on the dispatch slip."
              aria-label="Note for dispatch"
              className="mt-2 min-h-[88px] rounded-[12px] border-line-strong"
            />
          </PopoverContent>
        </Popover>
        <div className={SUB}>prints on the slip</div>
      </SoField>
    </section>
  );
}

// ─── Start (no customer yet) ─────────────────────────────────────

function StartScreen({
  customers,
  draft,
  savedDraft,
  onPick,
  onResume,
  onDiscard,
}: {
  customers: Customer[];
  draft: SalesOrderDraft;
  savedDraft: { draft: SalesOrderDraft; savedAt: string } | null;
  onPick: (id: string) => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const resumeCustomer = savedDraft ? customers.find((c) => c.id === savedDraft.draft.customer) : undefined;
  const resumeValue = savedDraft
    ? savedDraft.draft.lines.reduce((sum, line) => sum + (parseFloat(line.unit_price || "0") || 0) * (Number(line.qty_value) || 0), 0)
    : 0;
  return (
    <>
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <section className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)] sm:p-5" data-testid="sales-start-customer">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-plate text-[15px] font-semibold text-plate-fg">?</span>
            <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-content-1">Who is this order for?</h2>
          </div>
          <p className="mt-1 text-[13px] text-content-3">
            Type two letters to find the customer for this sales order, or pick a recent one. Their saved items, last
            order and rates load as soon as the customer is set.
          </p>
          <div className={cn(LABEL, "mb-1 mt-4")}>Bill to · customer</div>
          <CustomerQuickPick customers={customers} selectedId={draft.customer} onPick={onPick} inline />
          <label className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-content-3">
            <span>or the full list</span>
            <span className="relative min-w-[220px] flex-1 sm:max-w-[340px]">
              <select
                data-testid="sales-batch-customer"
                aria-label="Customer"
                value={draft.customer}
                onChange={(e) => onPick(e.target.value)}
                className={cn(INP, "h-9 cursor-pointer appearance-none pr-8")}
              >
                <option value="">Pick a customer</option>
                {customers.map((c: Customer) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" aria-hidden />
            </span>
          </label>
        </section>

        <div className="grid gap-3.5">
          {savedDraft ? (
            <section className="rounded-[18px] border border-info-border bg-info-bg p-4" data-testid="sales-resume-draft">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-primary">
                <History className="h-4 w-4" aria-hidden />
                Resume draft{clockTime(savedDraft.savedAt) ? ` from ${clockTime(savedDraft.savedAt)}` : ""}?
              </div>
              <p className="mt-1 text-[12.5px] text-content-2">
                {[
                  resumeCustomer?.name || "No customer yet",
                  `${savedDraft.draft.lines.length} line${savedDraft.draft.lines.length === 1 ? "" : "s"}`,
                  resumeValue > 0 ? inr(resumeValue) : "",
                  savedDraft.draft.order_name ? `job "${savedDraft.draft.order_name}"` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                . Drafts autosave in this browser as you type.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button type="button" size="sm" onClick={onResume} className="h-9 rounded-[10px]" data-testid="sales-resume-draft-submit">
                  Resume draft
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onDiscard} className="h-9 rounded-[10px] text-content-2">
                  Start fresh
                </Button>
              </div>
            </section>
          ) : null}
          <section className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-content-1">
              <Keyboard className="h-4 w-4 text-content-3" aria-hidden /> Keyboard first
            </div>
            <p className="mt-0.5 text-[12.5px] text-content-3">Built for a clerk who types many lines a day.</p>
            <ul className="mt-2.5 grid gap-1.5 text-[12.5px] text-content-2">
              {(
                [
                  ["↵", "pick the first match · move to the next box"],
                  ["⌘ K", "jump to the add-a-line row"],
                  ["Alt N", "blank line in the full editor"],
                  ["Alt ← →", "previous / next line in the editor"],
                  ["⌘ ↵", "place the order when every line is ready"],
                  ["Esc", "close the editor or a popup"],
                ] as const
              ).map(([key, text]) => (
                <li key={key} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2.5">
                  <kbd className="rounded-[6px] border border-line bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[11px] text-content-2">{key}</kbd>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-content-1">
              <ShoppingCart className="h-4 w-4 text-content-3" aria-hidden /> What loads once the customer is set
            </div>
            <p className="mt-1 text-[12.5px] text-content-3">
              Saved customer items (they resolve on save), the last order for a one-click repeat, recent orders and the
              last lane run. Ship to, promised dispatch and the job name sit in one row above the lines.
            </p>
          </section>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-[14px] border border-dashed border-line px-4 py-2.5 text-[12.5px] text-content-3">
        <span>
          <b className="font-semibold text-content-2">Ship to</b> · same as customer
        </span>
        <span>
          <b className="font-semibold text-content-2">Promised dispatch</b> · {longDate(draft.delivery_date)}
        </span>
        <span>
          <b className="font-semibold text-content-2">Plant</b> · Auto · planner
        </span>
        <span className="ml-auto hidden text-content-4 sm:inline">editable once the customer is set</span>
      </div>
    </>
  );
}

// ─── Success ─────────────────────────────────────────────────────

function PlacedScreen({
  placed,
  onNewForCustomer,
  onNew,
}: {
  placed: PlacedOrder;
  onNewForCustomer: () => void;
  onNew: () => void;
}) {
  const firstName = placed.customerName.split(/\s+/)[0] || "this customer";
  const tiles: [string, string, boolean][] = [
    ["Order", placed.number, true],
    ["Lines", String(placed.lines.length), false],
    ["Quantity", qtySummary(placed.kg, placed.pcs) || "—", false],
    ["Value", placed.value > 0 ? inr(placed.value) : "—", false],
    ["Promised dispatch", longDate(placed.dispatch), false],
  ];
  return (
    <section
      className="grid gap-6 rounded-[18px] border border-line bg-surface-1 p-5 shadow-[var(--shadow-sm)] sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,540px)]"
      data-testid="sales-order-placed"
    >
      <div className="min-w-0">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-success-bg text-success-fg">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[22px] font-semibold tracking-[-0.02em] text-content-1">
          Sales order sent to planner
          <span className="font-mono text-[22px] font-semibold text-primary">{placed.number}</span>
          {placed.name ? (
            <span className="self-center rounded-full bg-info-bg px-2.5 py-0.5 text-[13px] font-medium tracking-normal text-primary">{placed.name}</span>
          ) : null}
        </h2>
        <p className="mt-1.5 max-w-[560px] text-[13.5px] text-content-3">
          {[placed.customerName, `${placed.lines.length} line${placed.lines.length === 1 ? "" : "s"}`, qtySummary(placed.kg, placed.pcs), placed.value > 0 ? inr(placed.value) : ""]
            .filter(Boolean)
            .join(" · ")}
          . It is in the planning queue; the planner picks the plant and releases each line. Promised dispatch{" "}
          {longDate(placed.dispatch)}.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
          {tiles.map(([label, value, mono]) => (
            <div key={label} className="min-w-0 rounded-[12px] bg-surface-2 px-3 py-2.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-content-4">{label}</div>
              <div className={cn("mt-1 break-words text-[14.5px] font-semibold tabular-nums text-content-1", mono && "font-mono")}>{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {placed.id ? (
            <Button asChild className="h-10 gap-1.5 rounded-[11px]" data-testid="sales-placed-open-order">
              <Link href={`/sales/orders/${encodeURIComponent(placed.id)}`}>
                <FileText className="h-4 w-4" aria-hidden /> Open order
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="h-10 gap-1.5 rounded-[11px]">
            <Link href={`/dashboard/planner/control-tower/plan-queue?search=${encodeURIComponent(placed.number)}`}>
              <Layers className="h-4 w-4" aria-hidden /> Open in planner
            </Link>
          </Button>
          {placed.customerId ? (
            <Button type="button" variant="outline" onClick={onNewForCustomer} className="h-10 gap-1.5 rounded-[11px]" data-testid="sales-placed-new-for-customer">
              <Repeat className="h-4 w-4" aria-hidden /> New order for {firstName}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onNew} className="h-10 gap-1.5 rounded-[11px] text-content-2" data-testid="sales-placed-new">
            <Plus className="h-4 w-4" aria-hidden /> New order
          </Button>
        </div>
      </div>
      <div className="min-w-0 self-start overflow-hidden rounded-[14px] border border-line">
        <div className="bg-surface-2 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-content-3">What was sent</div>
        <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {placed.lines.map((line, index) => (
            <li key={`${line.title}-${index}`} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-2.5 px-3.5 py-2.5">
              <span className="pt-0.5 font-mono text-[12px] text-content-4">{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-content-1">{line.title}</span>
                <span className="block truncate font-mono text-[11.5px] text-content-3">{line.detail}</span>
              </span>
              <span className="font-mono text-[13.5px] font-semibold tabular-nums text-content-1">{line.value > 0 ? inr(line.value) : "—"}</span>
            </li>
          ))}
        </ol>
      </div>
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
  const innerPackRef =
    line.axis_values?.packaging_inner ||
    line.axis_values?.packaging_inner_ref ||
    line.axis_values?.primary_inner_pack;
  // No inner pouch picked on its own axis (it may come from the generic packaging axis, which the
  // server classifies): send only the number, never switch an inner pouch on without a material.
  if (!innerPackRef || (typeof innerPackRef === "string" && !innerPackRef.trim())) {
    return { primary_inner_pack: { pcs_per_pack: Math.floor(pcsPerPack), basis: "PCS_PER_PACK" } };
  }
  const primary: Record<string, any> = {
    enabled: true,
    pcs_per_pack: Math.floor(pcsPerPack),
    basis: "PCS_PER_PACK",
  };
  if (typeof innerPackRef === "string" && innerPackRef.trim()) {
    primary.material_code = innerPackRef.trim();
  } else if (innerPackRef && typeof innerPackRef === "object") {
    primary.material_id =
      innerPackRef.material_id ||
      innerPackRef.packaging_material_id ||
      innerPackRef.id ||
      undefined;
    primary.material_code =
      innerPackRef.material_code ||
      innerPackRef.code ||
      innerPackRef.value ||
      undefined;
  }
  return {
    primary_inner_pack: primary,
  };
}

function buildLineChemistrySnapshot(master: any) {
  const fixed = master?.fixed_attributes || {};
  const adhesive = Number(fixed.adhesive_gsm ?? fixed.adhesive_gsm_total ?? 0);
  const solvent = Number(fixed.solvent_gsm ?? fixed.solvent_gsm_total ?? 0);
  const total =
    (Number.isFinite(adhesive) && adhesive > 0 ? adhesive : 0) +
    (Number.isFinite(solvent) && solvent > 0 ? solvent : 0);
  if (total <= 0) return {};
  return {
    adhesive_gsm: Number.isFinite(adhesive) && adhesive > 0 ? adhesive : 0,
    adhesive_material_id: fixed.adhesive_material_id || undefined,
    adhesive_material_code: fixed.adhesive_material_code || undefined,
    adhesive_material_name: fixed.adhesive_material_name || undefined,
    solvent_gsm: Number.isFinite(solvent) && solvent > 0 ? solvent : 0,
    solvent_material_id: fixed.solvent_material_id || undefined,
    solvent_material_code: fixed.solvent_material_code || undefined,
    solvent_material_name: fixed.solvent_material_name || undefined,
    display_gsm_total: total,
    display_label: `A&S${Number(total.toFixed(3)).toString()}`,
  };
}

/** Everything still in the way of placing, each with a way to fix it. */
function ReadinessList({
  blockingIssues,
  warnings,
  isReady,
  onFix,
}: {
  blockingIssues: string[];
  warnings: string[];
  isReady: boolean;
  onFix: (issue: string) => void;
}) {
  return (
    <div data-testid="sales-create-readiness">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-full",
            isReady ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg",
          )}
        >
          {isReady ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-content-1">{isReady ? "Ready to place" : "Before you place"}</div>
          <div className="text-[12px] text-content-3">
            {isReady
              ? "Customer, lines, artwork, packing and material plan are clear."
              : `${blockingIssues.length} thing${blockingIssues.length === 1 ? "" : "s"} to fix`}
          </div>
        </div>
      </div>
      {blockingIssues.length ? (
        <ul className="grid max-h-[50vh] gap-0.5 overflow-y-auto p-1.5">
          {blockingIssues.map((issue, index) => (
            <li key={`${issue}-${index}`} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 rounded-[9px] px-2 py-1.5 text-[13px] text-content-1 hover:bg-surface-2">
              <span className="mt-[2px] grid h-[16px] w-[16px] place-items-center rounded-full bg-warning-bg text-[10px] font-bold text-warning-fg">!</span>
              <span className="min-w-0">{issue}</span>
              <button
                type="button"
                onClick={() => onFix(issue)}
                className="whitespace-nowrap text-[12.5px] font-semibold text-primary hover:underline"
              >
                Fix →
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <div className="m-1.5 mt-0 rounded-[10px] bg-surface-2 px-3 py-2 text-[12.5px] text-content-2">{warnings[0]}</div>
      ) : null}
    </div>
  );
}

// ─── Place bar ───────────────────────────────────────────────────

function StickyCartBar({
  lineCount,
  cartTotalKg,
  cartTotalPcs,
  cartTotalValue,
  blockingIssues,
  warnings,
  isReady,
  isSubmitting,
  onSubmit,
  customerId,
  firstMasterId,
  firstBlocker,
  readiness,
}: {
  lineCount: number;
  cartTotalKg: number;
  cartTotalPcs: number;
  cartTotalValue: number;
  customerId?: string;
  firstMasterId?: string;
  blockingIssues: string[];
  warnings: string[];
  isReady: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  firstBlocker?: string;
  readiness: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const qty = qtySummary(cartTotalKg, cartTotalPcs);
  return (
    <ActionBar testId="sales-create-bar">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[22px] font-semibold tabular-nums tracking-[-0.025em] text-content-1">
          {cartTotalValue > 0 ? inr(cartTotalValue) : "₹ —"}
        </span>
        <span className="text-[13px] text-content-2">
          {lineCount} {lineCount === 1 ? "line" : "lines"}
          {qty ? ` · ${qty}` : ""}
        </span>
        {blockingIssues.length ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="max-w-[min(420px,60vw)] self-center" title="See what is left to fix">
                <Pill tone="warn" className="max-w-full cursor-pointer hover:brightness-95">
                  <AlertTriangle className="h-3 w-3 flex-none" aria-hidden />
                  <span className="truncate">{firstBlocker}</span>
                  {blockingIssues.length > 1 ? <span className="flex-none">+{blockingIssues.length - 1}</span> : null}
                </Pill>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              className="w-[min(480px,calc(100vw-2rem))] p-0"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) setOpen(false);
              }}
            >
              {readiness}
            </PopoverContent>
          </Popover>
        ) : lineCount > 0 ? (
          <Pill tone="ok" className="self-center">all lines ready</Pill>
        ) : null}
        {!blockingIssues.length && warnings.length ? (
          <Pill className="max-w-[320px] self-center">
            <span className="truncate">{warnings[0]}</span>
          </Pill>
        ) : null}
      </div>
      <div className="grid w-full grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap">
        {/* Side exits: placing the order is the main road; a quotation or a stock order start from the same place. */}
        <Button asChild variant="ghost" className="h-10 rounded-[11px] text-content-2" data-testid="sales-create-make-for-stock">
          <Link href={firstMasterId ? `/dashboard/planner/control-tower/stock-launcher?master=${encodeURIComponent(firstMasterId)}` : "/dashboard/planner/control-tower/stock-launcher"}>
            Make for stock
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-10 rounded-[11px]" data-testid="sales-create-save-quotation">
          <Link href={customerId ? `/sales/quotations/new?customer=${encodeURIComponent(customerId)}` : "/sales/quotations/new"}>
            Save as quotation
          </Link>
        </Button>
        <Button
          data-testid="sales-create-submit"
          onClick={onSubmit}
          disabled={!isReady || isSubmitting}
          className="order-first col-span-2 h-11 gap-2 rounded-[11px] px-5 sm:order-none sm:h-10"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ClipboardCheck className="h-4 w-4" />
          )}
          {isSubmitting ? "Placing…" : "Place order"}
          <span className="hidden rounded-[5px] bg-white/15 px-1.5 py-0.5 text-[11px] font-medium sm:inline">
            ⌘↵
          </span>
        </Button>
      </div>
    </ActionBar>
  );
}

const RECENT_CUSTOMERS_KEY = "erp.sales.recentCustomers";

function readRecentCustomers(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_CUSTOMERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function rememberCustomer(id: string) {
  try {
    const next = [id, ...readRecentCustomers().filter((row) => row !== id)].slice(0, 5);
    window.localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(next));
  } catch {
    // Recent customers are a convenience only.
  }
}

/** Type two letters to find a customer; the last five picked are one tap away. */
function CustomerQuickPick({
  customers,
  selectedId,
  onPick,
  inline = false,
}: {
  customers: Customer[];
  selectedId: string;
  onPick: (id: string) => void;
  /** Start screen: a large field with the matches listed under it instead of a dropdown. */
  inline?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>([]);
  React.useEffect(() => setRecent(readRecentCustomers()), []);
  React.useEffect(() => {
    if (selectedId) {
      rememberCustomer(selectedId);
      setRecent(readRecentCustomers());
    }
  }, [selectedId]);
  const needle = query.trim().toLowerCase();
  const matches = React.useMemo(() => {
    if (needle.length < 2) return [];
    return customers
      .filter((c) => `${c.name} ${c.code || ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [customers, needle]);
  React.useEffect(() => setHighlight(0), [needle]);
  const recentRows = recent
    .map((id) => customers.find((c) => String(c.id) === id))
    .filter((c): c is Customer => Boolean(c) && String((c as Customer).id) !== String(selectedId));
  const pick = (id: string) => {
    onPick(id);
    setQuery("");
    setOpen(false);
  };
  const showList = inline ? matches.length > 0 : open && matches.length > 0;
  return (
    <div className={cn("relative", inline ? "" : "mb-1.5")}>
      <div className="relative">
        {inline ? <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-content-3" aria-hidden /> : null}
        <input
          type="search"
          value={query}
          autoFocus={inline}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((value) => Math.min(value + 1, Math.max(0, matches.length - 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((value) => Math.max(0, value - 1));
            } else if (e.key === "Enter" && matches[highlight]) {
              e.preventDefault();
              pick(String(matches[highlight].id));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Type 2 letters to find a customer"
          aria-label="Find customer"
          data-testid="sales-customer-search"
          className={cn(
            INP,
            inline
              ? "h-12 rounded-[14px] pl-11 pr-10 text-[15px] focus:ring-4 [&::-webkit-search-cancel-button]:hidden"
              : "pr-3",
          )}
        />
        {inline && query ? (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-content-3 hover:bg-surface-2 hover:text-content-1"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {!query && recentRows.length ? (
        <div className={cn("flex flex-wrap items-center gap-1.5", inline ? "mt-2.5" : "mt-1")} aria-label="Recent customers">
          {inline ? <span className="mr-0.5 text-[12px] text-content-3">Recent</span> : null}
          {recentRows.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(String(c.id))}
              className={cn(
                "max-w-[14rem] truncate rounded-full border border-line bg-surface-2 font-semibold text-content-2 transition-colors hover:border-line-strong hover:bg-surface-1",
                inline ? "px-3 py-1 text-[12.5px]" : "px-2 py-0.5 text-caption",
              )}
              data-testid={`sales-customer-recent-${c.id}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      {inline && needle.length >= 2 && !matches.length ? (
        <div className="mt-2 rounded-[12px] border border-dashed border-line px-3 py-3 text-[13px] text-content-3">
          No customer matches &ldquo;{query.trim()}&rdquo;. Check the spelling, or add the customer in Masters → Customers.
        </div>
      ) : null}
      {showList ? (
        <ul
          role="listbox"
          aria-label="Matching customers"
          className={cn(
            "overflow-y-auto border border-line bg-surface-1",
            inline
              ? "mt-2 max-h-[min(360px,45vh)] divide-y divide-line rounded-[14px]"
              : "absolute z-30 mt-1 max-h-64 w-full rounded-xl p-1 shadow-lg",
          )}
        >
          {matches.map((c, index) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={inline ? index === highlight : String(c.id) === String(selectedId)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(String(c.id))}
                className={cn(
                  "flex w-full items-center gap-3 text-left",
                  inline
                    ? cn("px-3 py-2.5", index === highlight ? "bg-info-bg" : "hover:bg-surface-2")
                    : "justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-2",
                )}
                data-testid={`sales-customer-match-${c.id}`}
              >
                {inline ? (
                  <>
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-line bg-surface-2 text-[12.5px] font-semibold text-content-2">
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-content-1">{c.name}</span>
                      <span className="block truncate text-[12px] text-content-3">
                        {[c.code, c.mailing_state, c.credit_days ? `${c.credit_days} days credit` : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {index === highlight ? <kbd className="hidden rounded border border-line bg-surface-1 px-1.5 font-mono text-[11px] text-content-3 sm:inline">↵</kbd> : null}
                  </>
                ) : (
                  <>
                    <span className="truncate">{c.name}</span>
                    {c.code ? <span className="shrink-0 font-mono text-caption text-content-3">{c.code}</span> : null}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
