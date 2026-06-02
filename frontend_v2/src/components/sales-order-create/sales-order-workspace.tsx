"use client"

/**
 * V3.7 Sales Order Create — workspace shell rebuilt to match
 * docs/mockups/sales-v37-create-bom.html.
 *
 * Visual layers:
 *   - Top stepper backbone (Customer → Build lines → Pricing → Review)
 *   - Customer / PO / dates / plant header strip (clean 5-column tile row)
 *   - Quick Start band (existing component)
 *   - Cart of lines with inline LineEditor + LiveBomRail (rail rendered next to expanded line via existing LineEditor wiring)
 *   - Sticky cart total bar at bottom with submit
 *
 * Wires only to existing services / hooks. No new fields, no schema change.
 */

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowRight,
    Calendar,
    CheckCircle2,
    ClipboardCheck,
    Factory,
    Loader2,
    Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

import { masterDataService, type Customer } from "@/services/master-data"
import { productMasterService } from "@/services/product-master"
import { salesService } from "@/services/sales"

import { useSalesDraft } from "./use-sales-draft"
import { Cart } from "./cart"
import { QuickStartBand } from "./quick-start-band"
import { CustomerContextPanel } from "./customer-context-panel"
import { buildSalesAxisValues } from "./axis-values"

export function SalesOrderV34Workspace() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { toast } = useToast()

    const initialMaster = searchParams?.get("product_master") || searchParams?.get("master") || ""
    const initialCustomer = searchParams?.get("customer") || ""

    const draftHook = useSalesDraft(initialCustomer)
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
    } = draftHook

    const { data: customers = [] } = useQuery({
        queryKey: ["customers"],
        queryFn: masterDataService.getCustomers,
        staleTime: 60_000,
    })
    const { data: masters = [] } = useQuery({
        queryKey: ["product-masters", "v34"],
        queryFn: () => productMasterService.list({ for_sales: true }),
        staleTime: 30_000,
    })

    const seededRef = React.useRef(false)
    React.useEffect(() => {
        if (seededRef.current) return
        if (initialMaster && draft.lines.length === 0) {
            seededRef.current = true
            addLine({ product_master: initialMaster })
        }
    }, [initialMaster, draft.lines.length, addLine])

    const customer = customers.find((c) => c.id === draft.customer)
    const axisBlockingIssues = React.useMemo(() => {
        const issues: string[] = []
        draft.lines.forEach((line, index) => {
            const master = masters.find((x) => x.id === line.product_master)
            if (!master) return
            buildSalesAxisValues(master, line).missingLabels.forEach((label) => {
                issues.push(`Line ${index + 1}: ${label}`)
            })
            ;(line.pre_submit_blockers || []).forEach((label) => {
                if (label) issues.push(`Line ${index + 1}: ${label}`)
            })
        })
        return issues
    }, [draft.lines, masters])
    const combinedBlockingIssues = React.useMemo(
        () => [...blockingIssues, ...axisBlockingIssues],
        [blockingIssues, axisBlockingIssues]
    )
    const combinedReadyToSubmit = combinedBlockingIssues.length === 0

    const createMutation = useMutation({
        mutationFn: () => {
            if (axisBlockingIssues.length > 0) {
                throw new Error(axisBlockingIssues[0])
            }
            return salesService.createOrder({
                customer: draft.customer,
                ship_to_customer: draft.ship_to_customer || draft.customer,
                address_override: draft.address_override,
                order_name: draft.order_name || `Order ${new Date().toISOString().slice(0, 10)}`,
                delivery_date: draft.delivery_date,
                remarks: draft.remarks,
                items: draft.lines.map((line) => {
                    const m = masters.find((x) => x.id === line.product_master)
                    const axis_values = buildSalesAxisValues(m, line).axisValues
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
                                  artwork_id: line.artwork_assignment?.artwork_id,
                                  cylinder_required: line.print_type === "ROTO",
                              }
                            : { enabled: false },
                        remarks: line.remarks,
                    }
                }),
            })
        },
        onSuccess: (data: any) => {
            toast({
                title: "Sales order sent to planner",
                description: `Order ${data?.order_number || data?.id || ""} · ${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"} · Planning queue`,
            })
            router.push("/sales/orders")
        },
        onError: (err: any) =>
            toast({
                title: "Could not create order",
                description: err?.message || "Try again",
                variant: "destructive",
            }),
    })

    const perLineIssues = React.useMemo(() => {
        const out: Record<string, string[]> = {}
        draft.lines.forEach((l) => {
            const issues: string[] = []
            if (!l.product_master) issues.push("Missing product master")
            if (l.product_master && !l.size_code) issues.push("Missing size")
            if (l.qty_value <= 0) issues.push("Quantity must be > 0")
            const master = masters.find((x) => x.id === l.product_master)
            if (master) issues.push(...buildSalesAxisValues(master, l).missingLabels)
            ;(l.pre_submit_blockers || []).forEach((issue) => {
                if (issue) issues.push(issue)
            })
            if (issues.length) out[l.id] = issues
        })
        return out
    }, [draft.lines, masters])

    return (
        <div className="mx-auto max-w-[1600px] space-y-3 pb-32" data-testid="sales-order-v34-workspace">
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
                <section className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                    <QuickStartBand
                        customerId={draft.customer}
                        customerName={customer?.name}
                        masters={masters}
                        onAdd={(seed) => addLine(seed)}
                    />
                    <CustomerContextPanel customerId={draft.customer} customerName={customer?.name} />
                </section>
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
                    <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                        <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Order remarks (optional)</Label>
                        <Textarea
                            value={draft.remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            placeholder="Special instructions for the whole order. Per-line notes live inside the line editor."
                            className="mt-1 min-h-[72px] rounded-xl border-slate-200 shadow-sm"
                        />
                    </div>
                    <BlockerPanel blockingIssues={combinedBlockingIssues} warnings={warnings} isReady={combinedReadyToSubmit} />
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
                onSubmit={() => createMutation.mutate()}
            />
        </div>
    )
}

// ─── Stepper ─────────────────────────────────────────────────────

function SalesStepper({ customerPicked, hasLines, ready }: { customerPicked: boolean; hasLines: boolean; ready: boolean }) {
    const steps = [
        { id: 1, label: "Customer & header", done: customerPicked, active: !customerPicked },
        { id: 2, label: "Build line items", done: hasLines, active: customerPicked && !hasLines },
        { id: 3, label: "Pricing & terms", done: false, active: customerPicked && hasLines && !ready },
        { id: 4, label: "Review & place", done: false, active: ready },
    ]
    return (
        <ol className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            {steps.map((s, i) => (
                <React.Fragment key={s.id}>
                    <li className={cn(
                        "inline-flex items-center gap-2 rounded-full px-3 py-1 ring-1",
                        s.active ? "bg-indigo-600 text-white ring-indigo-700 shadow-sm" :
                            s.done ? "bg-emerald-100 text-emerald-800 ring-emerald-200" :
                                "bg-slate-100 text-slate-500 ring-slate-200",
                    )}>
                        <span className={cn(
                            "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                            s.active ? "bg-white text-indigo-700" :
                                s.done ? "bg-emerald-600 text-white" :
                                    "bg-slate-300 text-white",
                        )}>{s.done ? "✓" : s.id}</span>
                        {s.label}
                    </li>
                    {i < steps.length - 1 ? <span className="text-slate-300">→</span> : null}
                </React.Fragment>
            ))}
        </ol>
    )
}

// ─── Subtle hero ─────────────────────────────────────────────────

function SubtleHero({ customer, customerCount, draft, cartTotalKg, cartTotalValue, isReady, blockerCount }: {
    customer: Customer | undefined
    customerCount: number
    draft: any
    cartTotalKg: number
    cartTotalValue: number
    isReady: boolean
    blockerCount: number
}) {
    return (
        <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white shadow-2xl shadow-violet-950/15">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(255,255,255,0.24),transparent_28rem)]" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-black uppercase tracking-[0.24em] text-indigo-100">
                        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-300" />
                        Sales Order · Create · Full Line Workspace
                    </div>
                    <h1 className="mt-1.5 font-display text-2xl font-black tracking-tight md:text-3xl">
                        {customer ? `${customer.name} order workspace` : "Every field, organised for fast order entry"}
                    </h1>
                    <p className="mt-1 max-w-4xl text-sm font-semibold text-indigo-100">
                        {customer
                            ? "Customer header, overlay shortcuts, repeat lines, full product-master axes, artwork, packing, quantity and live BOM now sit in one tabbed build surface."
                            : `Pick one of ${customerCount} customers to unlock overlays, repeat orders, and the line workspace.`}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black">
                        <span className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 ring-1", customer ? "bg-emerald-300/20 text-emerald-50 ring-emerald-200/30" : "bg-amber-300/20 text-amber-50 ring-amber-200/30")}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Customer {customer ? "set" : "pending"}
                        </span>
                        <span className="inline-flex h-8 items-center gap-1 rounded-full bg-white/12 px-3 text-white ring-1 ring-white/20">
                            Lines <span className="font-mono tabular-nums">{draft.lines.length}</span>
                        </span>
                        <span className="inline-flex h-8 items-center gap-1 rounded-full bg-white/12 px-3 text-white ring-1 ring-white/20">
                            KG <span className="font-mono tabular-nums">{cartTotalKg ? cartTotalKg.toLocaleString() : "—"}</span>
                        </span>
                        {cartTotalValue > 0 ? (
                            <span className="inline-flex h-8 items-center gap-1 rounded-full bg-white/12 px-3 text-white ring-1 ring-white/20">
                                Value <span className="font-mono tabular-nums">₹{Math.round(cartTotalValue).toLocaleString()}</span>
                            </span>
                        ) : null}
                        <span className={cn(
                            "inline-flex h-8 items-center gap-1 rounded-full px-3 ring-1",
                            isReady ? "bg-emerald-300/20 text-emerald-50 ring-emerald-200/30" : blockerCount > 0 ? "bg-rose-300/20 text-rose-50 ring-rose-200/30" : "bg-amber-300/20 text-amber-50 ring-amber-200/30",
                        )}>
                            {isReady ? "Ready" : `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`}
                        </span>
                    </div>
                </div>
                <div className="hidden rounded-2xl bg-white/12 p-3 ring-1 ring-white/20 backdrop-blur md:block">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-100">Flow</div>
                    <div className="mt-2 grid gap-1 text-xs font-bold">
                        <span>1. Header</span>
                        <span>2. Line tabs</span>
                        <span>3. Axes + artwork</span>
                        <span>4. BOM + blockers</span>
                    </div>
                </div>
            </div>
        </section>
    )
}

// ─── Customer header strip ───────────────────────────────────────

function CustomerHeaderStrip({ customers, draft, customer, onSetCustomer, onSetShipTo, onSetAddressOverride, onSetOrderName, onSetDeliveryDate }: {
    customers: Customer[]
    draft: any
    customer: Customer | undefined
    onSetCustomer: (v: string) => void
    onSetShipTo: (v: string) => void
    onSetAddressOverride: (v: string) => void
    onSetOrderName: (v: string) => void
    onSetDeliveryDate: (v: string) => void
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                {/* Bill-to customer tile */}
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Bill to</div>
                    <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50">
                        <Select value={draft.customer} onValueChange={onSetCustomer}>
                            <SelectTrigger className="h-10 rounded-xl border-0 bg-transparent shadow-none focus:ring-0" data-testid="sales-batch-customer">
                                <SelectValue placeholder="Pick a customer" />
                            </SelectTrigger>
                            <SelectContent>
                                {customers.map((c: Customer) => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {customer ? (
                        <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{customer.code || "—"}{customer.gst_no ? ` · GST ${customer.gst_no}` : ""}</div>
                    ) : null}
                </div>

                {/* Order name */}
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Order name</div>
                    <Input
                        value={draft.order_name}
                        onChange={(e) => onSetOrderName(e.target.value)}
                        placeholder="e.g. ABC May order"
                        className="mt-1 h-10 rounded-xl border-slate-200"
                    />
                </div>

                {/* PO date / promise date */}
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Promised dispatch</div>
                    <div className="mt-1 relative">
                        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                            type="date"
                            value={draft.delivery_date}
                            onChange={(e) => onSetDeliveryDate(e.target.value)}
                            className="h-10 rounded-xl border-slate-200 pl-8"
                        />
                    </div>
                </div>

                {/* Ship to */}
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Ship to</div>
                    <Select value={draft.ship_to_customer || "__same"} onValueChange={(v) => onSetShipTo(v === "__same" ? "" : v)}>
                        <SelectTrigger className="mt-1 h-10 rounded-xl border-slate-200">
                            <SelectValue placeholder="Same as customer" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__same">Same as customer</SelectItem>
                            {customers.map((c: Customer) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Plant placeholder */}
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Plant</div>
                    <div className="mt-1 inline-flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700">
                        <Factory className="h-3.5 w-3.5 text-slate-400" />
                        Auto · planner chooses
                    </div>
                </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Ship address</div>
                    <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-slate-700">
                        {shipToAddress(customers, draft, customer) || "Select bill-to/ship-to to preview address."}
                    </div>
                </div>
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Extra address / dispatch note (optional)</div>
                    <Input
                        value={draft.address_override}
                        onChange={(e) => onSetAddressOverride(e.target.value)}
                        placeholder="Optional address override, transporter note, delivery landmark, or attention line"
                        className="mt-1 h-10 rounded-xl border-slate-200"
                    />
                </div>
            </div>

            {customer ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-200">customer · {customer.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">price basis · KG (default)</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">overlay match · resolved on save</span>
                </div>
            ) : null}
        </section>
    )
}

function shipToAddress(customers: Customer[], draft: any, customer?: Customer) {
    const shipTo = customers.find((c) => c.id === draft.ship_to_customer) || customer
    return shipTo?.shipping_address || shipTo?.billing_address || ""
}

function buildLinePackagingSnapshot(line: any) {
    const pcsPerPack = Number(line.inner_pouch_pcs_per_pack || 0)
    if (!Number.isFinite(pcsPerPack) || pcsPerPack <= 0) return undefined
    return {
        primary_inner_pack: {
            enabled: true,
            pcs_per_pack: Math.floor(pcsPerPack),
            basis: "PCS_PER_PACK",
        },
    }
}

function BlockerPanel({ blockingIssues, warnings, isReady }: { blockingIssues: string[]; warnings: string[]; isReady: boolean }) {
    return (
        <section className={cn(
            "rounded-[18px] border p-4 shadow-sm",
            isReady ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/50",
        )}>
            <div className="flex items-center gap-2">
                <span className={cn(
                    "grid h-8 w-8 place-items-center rounded-xl text-white",
                    isReady ? "bg-emerald-600" : "bg-rose-600",
                )}>
                    {isReady ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </span>
                <div>
                    <div className={cn("text-[10px] font-black uppercase tracking-[0.2em]", isReady ? "text-emerald-700" : "text-rose-700")}>
                        {isReady ? "Ready to send" : "Submit blockers"}
                    </div>
                    <div className="text-sm font-black text-slate-950">
                        {isReady ? "BOM and order checks are clear" : `${blockingIssues.length} item${blockingIssues.length === 1 ? "" : "s"} need attention`}
                    </div>
                </div>
            </div>
            {blockingIssues.length ? (
                <ul className="mt-3 space-y-1.5 text-xs font-bold text-rose-800">
                    {blockingIssues.slice(0, 5).map((issue, index) => (
                        <li key={`${issue}-${index}`} className="rounded-lg bg-white/80 px-2.5 py-1.5 ring-1 ring-rose-100">
                            {issue}
                        </li>
                    ))}
                    {blockingIssues.length > 5 ? (
                        <li className="px-2.5 text-[11px] text-rose-700">+ {blockingIssues.length - 5} more blockers in the sticky bar</li>
                    ) : null}
                </ul>
            ) : (
                <div className="mt-3 rounded-lg bg-white/80 px-2.5 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-100">
                    Customer, line axes, quantity, artwork/ink guards, packing and BOM requirements are clear.
                </div>
            )}
            {warnings.length ? (
                <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-100">
                    {warnings[0]}
                </div>
            ) : null}
        </section>
    )
}

// ─── Sticky cart bar ─────────────────────────────────────────────

function StickyCartBar({ lineCount, cartTotalKg, cartTotalValue, blockingIssues, warnings, isReady, isSubmitting, onSubmit }: {
    lineCount: number
    cartTotalKg: number
    cartTotalValue: number
    blockingIssues: string[]
    warnings: string[]
    isReady: boolean
    isSubmitting: boolean
    onSubmit: () => void
}) {
    return (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-2xl shadow-slate-900/10 backdrop-blur sm:px-6 lg:left-[var(--sidebar-width,16rem)]">
            <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Cart</span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                            {lineCount} {lineCount === 1 ? "line" : "lines"}
                        </span>
                        {cartTotalKg > 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
                                {cartTotalKg.toLocaleString()} KG
                            </span>
                        ) : null}
                        {cartTotalValue > 0 ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                                ₹{Math.round(cartTotalValue).toLocaleString()}
                            </span>
                        ) : null}
                    </div>
                    {(blockingIssues.length > 0 || warnings.length > 0) ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            {blockingIssues.slice(0, 2).map((b, i) => (
                                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-bold text-rose-700 ring-1 ring-rose-200">
                                    <AlertTriangle className="h-3 w-3" />
                                    {b}
                                </span>
                            ))}
                            {blockingIssues.length > 2 ? <span className="text-rose-700">+ {blockingIssues.length - 2} more</span> : null}
                            {warnings.slice(0, 1).map((w, i) => (
                                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-800 ring-1 ring-amber-200">
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
                                ? "bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-600/25 hover:shadow-xl hover:shadow-emerald-600/30"
                                : "bg-slate-300",
                        )}
                    >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                        Create + send to planner
                        <ArrowRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
