"use client";

import Link from "next/link";

// Sales order create workspace shell with customer header, line builder, and sticky submit.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  Loader2,
  Plus,
  Search,
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
import { ActionBar, Pill } from "@/components/plate/steps";

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

  return (
    <div
      className="sales-create-shell mx-auto grid max-w-[1400px] gap-4 pb-36"
      data-testid="sales-order-v34-workspace"
    >
      <ComposerHeader
        customer={customer}
        customerId={draft.customer}
        lineCount={draft.lines.length}
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
        <AddLineBar
          masters={masters}
          customerId={draft.customer}
          customerName={customer?.name}
          onAdd={(seed) => addLine(seed)}
        />
      ) : null}

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

      {draft.lines.length > 0 ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]">
            <Label className="text-[14px] font-semibold text-content-1">
              Note for dispatch
            </Label>
            <div className="text-[12.5px] text-content-3">
              Client note · prints on the dispatch slip when written
            </div>
            <Textarea
              value={draft.remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="What the customer asked for on delivery, e.g. 'Deliver before 11 am, call Ramesh at the gate'. Shown on the order page and on the dispatch slip."
              className="mt-2 min-h-[72px] rounded-[12px] border-line-strong"
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
        customerId={draft.customer}
        firstMasterId={draft.lines[0]?.product_master || ""}
        firstBlocker={firstBlocker}
      />
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────

function ComposerHeader({
  customer,
  customerId,
  lineCount,
  cartTotalKg,
  cartTotalValue,
  isReady,
  blockerCount,
}: {
  customer: Customer | undefined;
  customerId: string;
  lineCount: number;
  cartTotalKg: number;
  cartTotalValue: number;
  isReady: boolean;
  blockerCount: number;
}) {
  const quoteHref = customerId
    ? `/sales/quotations/new?customer=${encodeURIComponent(customerId)}`
    : "/sales/quotations/new";
  return (
    <header className="flex flex-wrap items-start gap-4 pt-1">
      <div className="grid min-w-0 gap-1.5">
        <div className="text-[12.5px] text-content-3">
          Sales · New order
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-content-1">
          {customer ? `New order for ${customer.name}` : "New order"}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-content-3">
          <Pill tone={customer ? "ok" : "warn"}>
            <CheckCircle2 className="h-3 w-3" /> customer {customer ? "set" : "needed"}
          </Pill>
          <Pill>
            {lineCount} line{lineCount === 1 ? "" : "s"}
          </Pill>
          {cartTotalKg > 0 ? <Pill>{cartTotalKg.toLocaleString("en-IN")} kg</Pill> : null}
          {cartTotalValue > 0 ? (
            <Pill>₹{Math.round(cartTotalValue).toLocaleString("en-IN")}</Pill>
          ) : null}
          {lineCount > 0 ? (
            <Pill tone={isReady ? "ok" : "warn"}>
              {isReady ? "ready to place" : `${blockerCount} to fix`}
            </Pill>
          ) : null}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
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

// ─── Customer header strip ───────────────────────────────────────

function initials(name?: string) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] || "?").toUpperCase() + (words[1]?.[0] || "").toUpperCase();
}

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
    <section className="overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center gap-3.5 px-4 py-3.5 sm:px-5">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-[12px] bg-plate text-[15px] font-semibold text-plate-fg">
          {customer ? initials(customer.name) : "?"}
        </span>
        <div className="min-w-[200px] flex-1">
          <div className="truncate text-[17px] font-semibold tracking-[-0.015em] text-content-1">
            {customer ? customer.name : "Who is this order for?"}
          </div>
          <div className="flex flex-wrap gap-x-2 text-[12.5px] text-content-3">
            {customer ? (
              <>
                <span className="font-mono">{customer.code || "—"}</span>
                {customer.gst_no ? <span>· GST {customer.gst_no}</span> : null}
                {customer.credit_days ? <span>· {customer.credit_days} days credit</span> : null}
                <span>· price basis kg by default</span>
              </>
            ) : (
              <span>Type two letters to find a customer, or pick from the list.</span>
            )}
          </div>
        </div>
        {customer ? <Pill tone="ok" className="hidden sm:inline-flex">customer items resolve on save</Pill> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 border-t border-line px-4 py-3.5 sm:grid-cols-2 sm:px-5 md:grid-cols-6">
        <SoField label="Bill to · customer" className="md:col-span-2">
          <CustomerQuickPick
            customers={customers}
            selectedId={draft.customer}
            onPick={onSetCustomer}
          />
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
        <SoField label="Promised dispatch">
          <input
            type="date"
            aria-label="Promised dispatch"
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
        <SoField label="Job name" hint="optional · shown next to the SO number everywhere">
          <input
            value={draft.order_name}
            onChange={(e) => onSetOrderName(e.target.value)}
            placeholder="e.g. ABC May order"
            className={INP}
          />
        </SoField>
        <SoField
          label="Ship address"
          hint="blank uses the saved address"
          className="sm:col-span-2 md:col-span-6"
        >
          <textarea
            value={draft.address_override}
            onChange={(e) => onSetAddressOverride(e.target.value)}
            placeholder={
              savedShipAddress || "Type the ship-to address manually"
            }
            rows={2}
            className={cn(
              INP,
              "h-auto min-h-[58px] resize-y py-2 leading-5",
            )}
          />
          <div className="mt-1 truncate text-[12px] text-content-3">
            Saved ship address:{" "}
            {savedShipAddress || "not set for selected customer"}
          </div>
        </SoField>
      </div>
    </section>
  );
}

// ─── Add a line ──────────────────────────────────────────────────

/** Find a product master and add it as a new line; the customer's usual items sit underneath. */
function AddLineBar({
  masters,
  customerId,
  customerName,
  onAdd,
}: {
  masters: any[];
  customerId: string;
  customerName?: string;
  onAdd: (seed?: any) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const matches = React.useMemo(() => {
    if (!needle) return [];
    return masters
      .filter((m) => `${m.code} ${m.name} ${m.display_code || ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [masters, needle]);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pick = (id: string) => {
    onAdd({ product_master: id });
    setQuery("");
    setOpen(false);
  };
  return (
    <section className="rounded-[18px] border border-line bg-surface-1 p-3 shadow-[var(--shadow-sm)] sm:p-4" data-testid="sales-add-line-bar">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <div className="flex h-12 items-center gap-3 rounded-[14px] border border-line-strong bg-surface-1 px-3.5 transition focus-within:border-primary focus-within:ring-4 focus-within:ring-info-bg">
            <Search className="h-[18px] w-[18px] flex-none text-content-3" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  pick(String(matches[0].id));
                }
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Add a line: type a product master code or name"
              aria-label="Find a product to add"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-content-1 outline-none placeholder:text-content-4"
              data-testid="sales-add-line-search"
            />
            <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-content-4 sm:inline">⌘ K</kbd>
          </div>
          {open && matches.length ? (
            <ul
              role="listbox"
              aria-label="Matching products"
              className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-[14px] border border-line bg-surface-1 p-1.5 shadow-[var(--shadow-lg)]"
            >
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(String(m.id))}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-3 py-2 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-content-1">{m.name}</span>
                      <span className="block font-mono text-[12px] text-content-3">{m.code}</span>
                    </span>
                    <span className="text-[12px] text-content-3">
                      {(m.layer_template || []).length} layers · {String(m.product_kind || "").toLowerCase()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Button variant="outline" onClick={() => onAdd()} className="h-12 gap-1.5 rounded-[14px] px-4">
          <Plus className="h-4 w-4" /> Blank line
        </Button>
      </div>
      <div className="mt-3">
        <QuickStartBand
          customerId={customerId}
          customerName={customerName}
          masters={masters}
          onAdd={(seed) => onAdd(seed)}
        />
      </div>
      <details className="group mt-3">
        <summary
          className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-content-3 hover:text-content-1"
          data-testid="sales-quick-start-toggle"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="group-open:hidden">Show this customer&apos;s history</span>
          <span className="hidden group-open:inline">Hide this customer&apos;s history</span>
        </summary>
        <div className="mt-2">
          <CustomerContextPanel customerId={customerId} customerName={customerName} />
        </div>
      </details>
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
    <section className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]" data-testid="sales-create-readiness">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-full",
            isReady ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg",
          )}
        >
          {isReady ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </span>
        <div>
          <div className="text-[14px] font-semibold text-content-1">
            {isReady ? "Ready to place" : "Before you place"}
          </div>
          <div className="text-[12.5px] text-content-3">
            {isReady
              ? "Customer, lines, artwork, packing and material plan are clear."
              : `${blockingIssues.length} thing${blockingIssues.length === 1 ? "" : "s"} to fix`}
          </div>
        </div>
      </div>
      {blockingIssues.length ? (
        <ul className="mt-3 grid gap-1.5">
          {blockingIssues.slice(0, 6).map((issue, index) => (
            <li key={`${issue}-${index}`} className="flex items-start gap-2 text-[13px] text-content-1">
              <span className="mt-[3px] grid h-[16px] w-[16px] flex-none place-items-center rounded-full bg-warning-bg text-[10px] font-bold text-warning-fg">!</span>
              <span className="min-w-0">{issue}</span>
            </li>
          ))}
          {blockingIssues.length > 6 ? (
            <li className="pl-6 text-[12.5px] text-content-3">+ {blockingIssues.length - 6} more</li>
          ) : null}
        </ul>
      ) : null}
      {warnings.length ? (
        <div className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px] text-content-2">
          {warnings[0]}
        </div>
      ) : null}
    </section>
  );
}

// ─── Place bar ───────────────────────────────────────────────────

function StickyCartBar({
  lineCount,
  cartTotalKg,
  cartTotalValue,
  blockingIssues,
  warnings,
  isReady,
  isSubmitting,
  onSubmit,
  customerId,
  firstMasterId,
  firstBlocker,
}: {
  lineCount: number;
  cartTotalKg: number;
  cartTotalValue: number;
  customerId?: string;
  firstMasterId?: string;
  blockingIssues: string[];
  warnings: string[];
  isReady: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  firstBlocker?: string;
}) {
  return (
    <ActionBar testId="sales-create-bar">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[22px] font-semibold tabular-nums tracking-[-0.025em] text-content-1">
          {cartTotalValue > 0 ? `₹${Math.round(cartTotalValue).toLocaleString("en-IN")}` : "₹ —"}
        </span>
        <span className="text-[13px] text-content-2">
          {lineCount} {lineCount === 1 ? "line" : "lines"}
          {cartTotalKg > 0 ? ` · ${cartTotalKg.toLocaleString("en-IN")} kg` : ""}
        </span>
        {blockingIssues.length ? (
          <Pill tone="warn" className="max-w-[min(420px,60vw)]">
            <AlertTriangle className="h-3 w-3 flex-none" />
            <span className="truncate">{firstBlocker}</span>
            {blockingIssues.length > 1 ? <span className="flex-none">+{blockingIssues.length - 1}</span> : null}
          </Pill>
        ) : lineCount > 0 ? (
          <Pill tone="ok">all lines ready</Pill>
        ) : null}
        {!blockingIssues.length && warnings.length ? (
          <Pill className="max-w-[320px]">
            <Sparkles className="h-3 w-3 flex-none" />
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
          Place order
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
}: {
  customers: Customer[];
  selectedId: string;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
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
  const recentRows = recent
    .map((id) => customers.find((c) => String(c.id) === id))
    .filter((c): c is Customer => Boolean(c) && String((c as Customer).id) !== String(selectedId));
  const pick = (id: string) => {
    onPick(id);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="relative mb-1.5">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            pick(String(matches[0].id));
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Type 2 letters to find a customer"
        aria-label="Find customer"
        data-testid="sales-customer-search"
        className={cn(INP, "pr-3")}
      />
      {open && matches.length ? (
        <ul
          role="listbox"
          aria-label="Matching customers"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface-1 p-1 shadow-lg"
        >
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={String(c.id) === String(selectedId)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(String(c.id))}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
                data-testid={`sales-customer-match-${c.id}`}
              >
                <span className="truncate">{c.name}</span>
                {c.code ? <span className="shrink-0 font-mono text-caption text-content-3">{c.code}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!query && recentRows.length ? (
        <div className="mt-1 flex flex-wrap gap-1" aria-label="Recent customers">
          {recentRows.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(String(c.id))}
              className="max-w-[12rem] truncate rounded-full border border-line bg-surface-2 px-2 py-0.5 text-caption font-semibold text-content-2 hover:bg-surface-1"
              data-testid={`sales-customer-recent-${c.id}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

