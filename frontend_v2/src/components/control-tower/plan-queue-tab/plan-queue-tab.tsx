"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    ClipboardList,
    Filter,
    Image as ImageIcon,
    Layers as LayersIcon,
    Package,
    PauseCircle,
    Printer,
    RefreshCw,
    Rocket,
    Search,
    Settings2,
    Sparkles,
    X,
    Zap,
} from "lucide-react";

import { plannerService, type PlannerControlOrder, type PlannerOrderKind, type PlannerInventoryOption } from "@/services/planner";
import { Card, Hero, Button, EmptyState, Chip } from "@/components/_planner-ui";
import { useToast } from "@/hooks/use-toast";
import { HealthBar, type HealthSegment } from "../HealthBar";
import { InventorySelectDialog } from "../inventory-select-dialog";
import { ArtworkPickerDialog } from "../artwork-picker-dialog";
import { ageInfo, dueInfo, ageToneColor, dueToneColor } from "../_shared/age";
import { formatDisplayDate } from "@/lib/date-format";

function fmt(n: any, decimals = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function sourceBucket(option: PlannerInventoryOption) {
    return String(option.source_bucket || "").toUpperCase();
}

function signatureMode(option: PlannerInventoryOption) {
    return String(option.signature_match_mode || "").toUpperCase();
}

function isExactFgOption(option: PlannerInventoryOption) {
    return sourceBucket(option) === "FINISHED_STOCK" && signatureMode(option) === "FINAL_SPEC";
}

function isReusableRollOption(option: PlannerInventoryOption) {
    return sourceBucket(option) !== "FINISHED_STOCK";
}

function plannerRowKey(row: PlannerControlOrder) {
    return `${row.order_kind}:${row.order_id}:${row.sales_order_item_id || "order"}`;
}

function widthMatchLabel(option: PlannerInventoryOption) {
    const mode = String(option.width_match_mode || "").toUpperCase();
    if (mode === "EXACT_WIDTH") return "exact width";
    if (mode === "CAN_SLIT" || mode === "WIDER_SLITTABLE" || option.can_slit_to_required_width) return "slit required";
    if (mode === "WIDTH_NOT_REQUIRED") return "width n/a";
    if (mode === "TOO_NARROW") return "too narrow";
    return "";
}

// Legacy alias kept for the few internal sites still using it
function dueLabel(dateStr: string | null | undefined) {
    const d = dueInfo(dateStr);
    return { label: d.label, tone: d.tone, days: d.days };
}

function deriveSegments(o: PlannerControlOrder): HealthSegment[] {
    const mathOk = o.math_valid !== false;
    const artworkRequired = !!o.artwork_assignment_required;
    const artworkAssigned = !!o.assigned_artwork_id;
    const blockerCount = ((o as any).blockers as any[] | undefined)?.length || 0;
    const lineCount = o.material_plan_summary?.line_count ?? 0;
    return [
        { key: "math", state: mathOk ? "ok" : "blocked", label: "Math", detail: mathOk ? "valid" : (o.math_error || "math invalid") },
        { key: "artwork", state: !artworkRequired ? "skip" : artworkAssigned ? "ok" : "warn", label: "Artwork", detail: !artworkRequired ? "n/a" : artworkAssigned ? "assigned" : "pending" },
        { key: "material", state: lineCount === 0 ? "skip" : blockerCount > 0 ? "blocked" : "ok", label: "Material", detail: blockerCount > 0 ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}` : `${lineCount} lines` },
        { key: "route", state: Number.isFinite(o.required_start_step) && Number.isFinite(o.route_last_step_index) ? "ok" : "warn", label: "Route", detail: `${o.required_start_step ?? "?"} → ${o.route_last_step_index ?? "?"}` },
    ];
}

type FgFilter = "all" | "POUCH" | "ROLL";
type SourceFilter = "all" | "FG" | "WIP" | "FRESH" | "BLOCKED";
type ReleaseFilter = "all" | "ready" | "blocked" | "artwork";
type LifecycleFilter = "all" | "partial_replan" | "partial_dispatchable";
type AgeFilter = "all" | "0-3d" | "4-7d" | "8-14d" | "15-30d" | "30+d";
type PrintFilter = "all" | "FLEXO" | "ROTO" | "DIGITAL" | "NO_PRINT";
type QuickPill = "all" | "hot" | "ready" | "blocked" | "artwork" | "partial" | "aged" | "recent";

interface Filters {
    fgType: FgFilter;
    customer: string;
    template: string;
    material: string;
    minWidth: string;
    maxWidth: string;
    sourcePath: SourceFilter;
    release: ReleaseFilter;
    lifecycle: LifecycleFilter;
    search: string;
    overdueOnly: boolean;
    age: AgeFilter;
    print: PrintFilter;
}
const EMPTY_FILTERS: Filters = {
    fgType: "all", customer: "all", template: "all", material: "all",
    minWidth: "", maxWidth: "", sourcePath: "all", release: "all", search: "",
    overdueOnly: false, age: "all", print: "all", lifecycle: "all",
};

function isPartialReplanRow(row: PlannerControlOrder) {
    const lineStatus = String(row.line_status || "").toUpperCase();
    const replanKg = Number(row.partial_shortfall_kg ?? row.qty_replan_remaining_kg ?? 0);
    return Boolean(row.partial_replan_required) || (lineStatus === "PARTIAL" && replanKg > 0);
}

function rowMatchesFilters(row: PlannerControlOrder, f: Filters): boolean {
    const fgType = String(row.fg_type || row.final_product_type || "").toUpperCase();
    if (f.fgType !== "all" && !fgType.includes(f.fgType)) return false;
    const customerName = String((row as any).customer_name || "");
    if (f.customer !== "all" && customerName !== f.customer) return false;
    if (f.template !== "all" && row.template_name !== f.template) return false;
    if (f.material !== "all") {
        const layers = (row.display_layers && row.display_layers.length ? row.display_layers : Array.isArray(row.layer_snapshot) ? row.layer_snapshot.map((l: any) => l?.name || "") : []).join(" ").toUpperCase();
        if (!layers.includes(f.material.toUpperCase())) return false;
    }
    const width = Number(row.effective_dims?.width_mm || row.geometry_override?.width_mm || 0);
    if (f.minWidth && Number.isFinite(width) && width < Number(f.minWidth)) return false;
    if (f.maxWidth && Number.isFinite(width) && width > Number(f.maxWidth)) return false;
    if (f.search) {
        const haystack = `${row.order_number} ${row.template_name} ${customerName}`.toLowerCase();
        if (!haystack.includes(f.search.toLowerCase())) return false;
    }
    if (f.overdueOnly) {
        const due = dueLabel((row as any).delivery_date);
        if (!Number.isFinite(due.days) || due.days >= 0) return false;
    }
    if (f.release !== "all") {
        const blockers = ((row as any).blockers as any[] | undefined)?.length || 0;
        const isReady = row.math_valid !== false && (!row.artwork_assignment_required || !!row.assigned_artwork_id) && blockers === 0;
        const isBlocked = blockers > 0 || row.math_valid === false;
        const needsArtwork = !!row.artwork_assignment_required && !row.assigned_artwork_id;
        if (f.release === "ready" && !isReady) return false;
        if (f.release === "blocked" && !isBlocked) return false;
        if (f.release === "artwork" && !needsArtwork) return false;
    }
    if (f.lifecycle !== "all") {
        const partial = isPartialReplanRow(row);
        const dispatchable = Number(row.qty_dispatchable || 0) > 0;
        if (f.lifecycle === "partial_replan" && !partial) return false;
        if (f.lifecycle === "partial_dispatchable" && !(partial && dispatchable)) return false;
    }
    if (f.sourcePath !== "all") {
        const fgAvail = !!row.source_availability?.has_fg;
        const wipAvail = !!row.source_availability?.has_wip;
        const blockers = ((row as any).blockers as any[] | undefined)?.length || 0;
        const isFg = fgAvail;
        const isWip = !fgAvail && wipAvail;
        const isFresh = !fgAvail && !wipAvail;
        if (f.sourcePath === "FG" && !isFg) return false;
        if (f.sourcePath === "WIP" && !isWip) return false;
        if (f.sourcePath === "FRESH" && !isFresh) return false;
        if (f.sourcePath === "BLOCKED" && blockers === 0) return false;
    }
    if (f.age !== "all") {
        const a = ageInfo((row as any).created_at);
        if (!a || a.bucket !== f.age) return false;
    }
    if (f.print !== "all") {
        const printSnap = (row.printing_snapshot || {}) as any;
        const pType = String((row as any).print_type || printSnap.print_type || printSnap.type || "").toUpperCase();
        const pEnabled =
            typeof (row as any).printing_enabled === "boolean"
                ? Boolean((row as any).printing_enabled)
                : printSnap.enabled !== false && (printSnap.front_colors_count > 0 || (printSnap.front_colors || []).length > 0);
        if (f.print === "NO_PRINT") {
            if (pEnabled) return false;
        } else {
            if (pType !== f.print) return false;
        }
    }
    if (f.lifecycle !== "all") {
        const isPartial = isPartialReplanRow(row);
        const hasDispatchable = Number(row.qty_dispatchable || 0) > 0;
        if (f.lifecycle === "partial_replan" && !isPartial) return false;
        if (f.lifecycle === "partial_dispatchable" && !(isPartial && hasDispatchable)) return false;
    }
    return true;
}

// Quick filter pill semantics
function applyQuickPill(filters: Filters, pill: QuickPill): Filters {
    const reset: Filters = { ...EMPTY_FILTERS, search: filters.search };
    switch (pill) {
        case "all": return reset;
        case "hot": return { ...reset, overdueOnly: true };
        case "ready": return { ...reset, release: "ready" };
        case "blocked": return { ...reset, release: "blocked" };
        case "artwork": return { ...reset, release: "artwork" };
        case "partial": return { ...reset, lifecycle: "partial_replan" };
        case "aged": return { ...reset, age: "30+d" };
        case "recent": return { ...reset, age: "0-3d" };
    }
}

function activePillFor(filters: Filters): QuickPill {
    if (filters.overdueOnly && filters.release === "all" && filters.age === "all") return "hot";
    if (filters.release === "ready" && filters.age === "all") return "ready";
    if (filters.release === "blocked" && filters.age === "all") return "blocked";
    if (filters.release === "artwork") return "artwork";
    if (filters.lifecycle === "partial_replan") return "partial";
    if (filters.age === "30+d" && filters.release === "all") return "aged";
    if (filters.age === "0-3d" && filters.release === "all") return "recent";
    return "all";
}

export default function PlanQueueTab() {
    const queryClient = useQueryClient();
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [selectedKey, setSelectedKey] = useState<string>("");
    const [releaseDialogOrder, setReleaseDialogOrder] = useState<PlannerControlOrder | null>(null);
    const [artworkDialogOrder, setArtworkDialogOrder] = useState<PlannerControlOrder | null>(null);

    const serverFilters = useMemo(() => ({
        queue_search: filters.search,
        queue_customer: filters.customer === "all" ? "" : filters.customer,
        queue_template: filters.template === "all" ? "" : filters.template,
        queue_fg_type: filters.fgType === "all" ? "" : filters.fgType,
        queue_material: filters.material === "all" ? "" : filters.material,
        queue_source_path: filters.sourcePath === "all" ? "" : filters.sourcePath,
        queue_release: filters.release === "all" ? "" : filters.release,
        queue_lifecycle: filters.lifecycle === "all" ? "" : filters.lifecycle,
        queue_age: filters.age === "all" ? "" : filters.age,
        queue_print: filters.print === "all" ? "" : filters.print,
        queue_min_width: filters.minWidth,
        queue_max_width: filters.maxWidth,
        queue_overdue_only: filters.overdueOnly,
    }), [
        filters.search,
        filters.customer,
        filters.template,
        filters.fgType,
        filters.material,
        filters.sourcePath,
        filters.release,
        filters.lifecycle,
        filters.age,
        filters.print,
        filters.minWidth,
        filters.maxWidth,
        filters.overdueOnly,
    ]);

    const hubQ = useQuery({
        queryKey: ["planner-control-hub-pq-v3", serverFilters],
        queryFn: () => plannerService.getControlHub({
            summary: true,
            planning_limit: 100,
            active_limit: 0,
            history_limit: 0,
            scan_limit: 600,
            timeout_ms: 12000,
            ...serverFilters,
        }),
        refetchInterval: 60_000,
        staleTime: 30_000,
    });
    const orders = hubQ.data?.orders ?? [];

    const distinctCustomers = useMemo(() => {
        const set = new Set<string>();
        orders.forEach((o) => { const c = (o as any).customer_name as string | undefined; if (c) set.add(c); });
        return Array.from(set).sort();
    }, [orders]);
    const distinctTemplates = useMemo(() => {
        const set = new Set<string>();
        orders.forEach((o) => { if (o.template_name) set.add(o.template_name); });
        return Array.from(set).sort();
    }, [orders]);

    const filtered = useMemo(() => orders.filter((o) => rowMatchesFilters(o, filters)), [orders, filters]);

    const selected = useMemo(() => {
        const found = filtered.find((o) => plannerRowKey(o) === selectedKey);
        return found || filtered[0] || null;
    }, [filtered, selectedKey]);

    const selectedDetailQ = useQuery({
        queryKey: ["planner-control-hub-pq-detail-v1", selected?.order_kind, selected?.order_id, selected?.sales_order_item_id || ""],
        queryFn: () => plannerService.getControlHub({
            planning_limit: 0,
            active_limit: 0,
            history_limit: 0,
            detail_order_kind: selected!.order_kind,
            detail_order_id: selected!.order_id,
            detail_sales_order_item_id: selected!.sales_order_item_id || undefined,
            timeout_ms: 12000,
        }),
        enabled: Boolean(selected?.order_kind && selected?.order_id),
        staleTime: 20_000,
    });

    const selectedDetail = selectedDetailQ.data?.detail_order || selected;

    const kpis = useMemo(() => {
        const total = filtered.length;
        let ready = 0, blocked = 0, artwork = 0, overdue = 0, totalKg = 0;
        for (const o of filtered) {
            const blockerCount = ((o as any).blockers as any[] | undefined)?.length || 0;
            const isReady = o.math_valid !== false && (!o.artwork_assignment_required || !!o.assigned_artwork_id) && blockerCount === 0;
            const needsArtwork = !!o.artwork_assignment_required && !o.assigned_artwork_id;
            const isBlocked = blockerCount > 0 || o.math_valid === false;
            if (isReady) ready++;
            if (needsArtwork) artwork++;
            if (isBlocked) blocked++;
            const due = dueLabel((o as any).delivery_date);
            if (Number.isFinite(due.days) && due.days < 0) overdue++;
            totalKg += Number(o.required_qty_kg || 0);
        }
        return [
            { eyebrow: "Filtered queue", value: fmt(total), sub: `${fmt(orders.length)} total`, accent: "default" as const },
            { eyebrow: "Ready", value: fmt(ready), sub: "release-eligible", accent: "success" as const },
            { eyebrow: "Blocked", value: fmt(blocked), sub: "with blockers", accent: blocked > 0 ? ("danger" as const) : ("default" as const) },
            { eyebrow: "Artwork pending", value: fmt(artwork), sub: "awaiting assignment", accent: artwork > 0 ? ("warn" as const) : ("default" as const) },
            { eyebrow: "Overdue", value: fmt(overdue), sub: "past due date", accent: overdue > 0 ? ("danger" as const) : ("default" as const) },
            { eyebrow: "Required KG", value: fmt(totalKg, 0), sub: "queue weight", accent: "info" as const },
        ];
    }, [filtered, orders.length]);

    function clearFilters() { setFilters(EMPTY_FILTERS); }
    const activeFilterCount = (Object.keys(filters) as (keyof Filters)[]).reduce((acc, key) => {
        const v = filters[key];
        if (key === "overdueOnly") return acc + (v ? 1 : 0);
        if (typeof v === "string") return acc + (v && v !== "all" ? 1 : 0);
        return acc;
    }, 0);

    function invalidateAll() {
        queryClient.invalidateQueries({ queryKey: ["planner-control-hub-pq-v3"] });
        queryClient.invalidateQueries({ queryKey: ["planner-control-hub-pq-detail-v1"] });
        queryClient.invalidateQueries({ queryKey: ["planner-control-hub-ct-v3"] });
        queryClient.invalidateQueries({ queryKey: ["planner-control-hub-lp-v3"] });
        queryClient.invalidateQueries({ queryKey: ["planner-control-hub-si-v4"] });
        queryClient.invalidateQueries({ queryKey: ["planner-control-hub-ct-trace-v3"] });
        queryClient.invalidateQueries({ queryKey: ["planner-jobs-lp-v2"] });
        queryClient.invalidateQueries({ queryKey: ["planner-jobs-si-v3"] });
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Hero
                eyebrow="Planner Command Tower · Tab 2"
                title="Plan Queue"
                subtitle="Filter, inspect, and release the rows that are ready to move forward."
                actions={
                    <Button variant="ghost" onClick={() => hubQ.refetch()}>
                        <RefreshCw size={14} className={hubQ.isFetching ? "spin" : ""} style={{ marginRight: 6 }} />
                        Refresh
                    </Button>
                }
                kpis={kpis as any}
            />

            {/* Quick filter pills + search */}
            <Card>
                {(() => {
                    const activePill = activePillFor(filters);
                    // Compute pill counts from full orders set
                    const pillCounts = (() => {
                        let hot = 0, ready = 0, blocked = 0, artwork = 0, partial = 0, aged = 0, recent = 0;
                        for (const o of orders) {
                            const blkrs = ((o as any).blockers as any[] | undefined)?.length || 0;
                            const due = dueLabel((o as any).delivery_date);
                            const isReady = o.math_valid !== false && (!o.artwork_assignment_required || !!o.assigned_artwork_id) && blkrs === 0;
                            const isBlocked = blkrs > 0 || o.math_valid === false;
                            const needsArtwork = !!o.artwork_assignment_required && !o.assigned_artwork_id;
                            if (Number.isFinite(due.days) && due.days < 0) hot++;
                            if (isReady) ready++;
                            if (isBlocked) blocked++;
                            if (needsArtwork) artwork++;
                            if (isPartialReplanRow(o)) partial++;
                            const a = ageInfo((o as any).created_at);
                            if (a?.bucket === "30+d") aged++;
                            if (a?.bucket === "0-3d") recent++;
                        }
                        return { hot, ready, blocked, artwork, partial, aged, recent };
                    })();
                    return (
                        <>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    <QuickPill label="All" count={orders.length} active={activePill === "all"} onClick={() => setFilters(applyQuickPill(filters, "all"))} tone="brand" />
                                    <QuickPill label="Hot · overdue" count={pillCounts.hot} active={activePill === "hot"} onClick={() => setFilters(applyQuickPill(filters, "hot"))} tone="danger" />
                                    <QuickPill label="Ready" count={pillCounts.ready} active={activePill === "ready"} onClick={() => setFilters(applyQuickPill(filters, "ready"))} tone="success" />
                                    <QuickPill label="Blocked" count={pillCounts.blocked} active={activePill === "blocked"} onClick={() => setFilters(applyQuickPill(filters, "blocked"))} tone="danger" />
                                    <QuickPill label="Artwork" count={pillCounts.artwork} active={activePill === "artwork"} onClick={() => setFilters(applyQuickPill(filters, "artwork"))} tone="warn" />
                                    <QuickPill label="Partial replan" count={pillCounts.partial} active={activePill === "partial"} onClick={() => setFilters(applyQuickPill(filters, "partial"))} tone="warn" />
                                    <QuickPill label="Aged · 30d+" count={pillCounts.aged} active={activePill === "aged"} onClick={() => setFilters(applyQuickPill(filters, "aged"))} tone="warn" />
                                    <QuickPill label="Recent · ≤3d" count={pillCounts.recent} active={activePill === "recent"} onClick={() => setFilters(applyQuickPill(filters, "recent"))} tone="info" />
                                </div>
                                <div style={{ position: "relative", minWidth: 260 }}>
                                    <Search size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                                    <input
                                        type="text"
                                        value={filters.search}
                                        onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                                        placeholder="Search order, customer, template"
                                        style={{
                                            width: "100%",
                                            padding: "9px 12px 9px 32px",
                                            fontSize: 13,
                                            fontFamily: "var(--f-ui)",
                                            background: "var(--surface-1)",
                                            border: "1px solid var(--border-soft)",
                                            borderRadius: "var(--r-pill)",
                                            outline: "none",
                                            boxShadow: "var(--sh-flat)",
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Detailed filters */}
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
                                gap: 10,
                                paddingTop: 12,
                                borderTop: "1px solid var(--border-soft)",
                            }}>
                                <FilterPanel title="Identity" tone="brand">
                                    <PillSelect
                                        label="FG"
                                        value={filters.fgType}
                                        options={[{ v: "all", l: "All" }, { v: "POUCH", l: "Pouch" }, { v: "ROLL", l: "Roll" }]}
                                        onChange={(v) => setFilters((f) => ({ ...f, fgType: v as FgFilter }))}
                                    />
                                    <NativeSelect
                                        label={`Customer (${distinctCustomers.length})`}
                                        value={filters.customer}
                                        options={[["all", "All customers"], ...distinctCustomers.map((c) => [c, c] as [string, string])]}
                                        onChange={(v) => setFilters((f) => ({ ...f, customer: v }))}
                                    />
                                    <NativeSelect
                                        label={`Template (${distinctTemplates.length})`}
                                        value={filters.template}
                                        options={[["all", "All templates"], ...distinctTemplates.map((t) => [t, t.length > 36 ? `${t.slice(0, 34)}…` : t] as [string, string])]}
                                        onChange={(v) => setFilters((f) => ({ ...f, template: v }))}
                                    />
                                </FilterPanel>

                                <FilterPanel title="Spec" tone="info">
                                    <NativeSelect
                                        label="Material"
                                        value={filters.material}
                                        options={[["all", "Any"], ["LDPE", "LDPE"], ["HDPE", "HDPE"], ["PET", "PET"], ["BOPP", "BOPP"], ["POLY", "POLY"], ["PA", "PA"]]}
                                        onChange={(v) => setFilters((f) => ({ ...f, material: v }))}
                                    />
                                    <PillSelect
                                        label="Print"
                                        value={filters.print}
                                        options={[
                                            { v: "all", l: "Any" },
                                            { v: "FLEXO", l: "FLEXO" },
                                            { v: "ROTO", l: "ROTO" },
                                            { v: "NO_PRINT", l: "No print" },
                                        ]}
                                        onChange={(v) => setFilters((f) => ({ ...f, print: v as PrintFilter }))}
                                    />
                                    <RangeRow
                                        label="Width (mm)"
                                        minValue={filters.minWidth}
                                        maxValue={filters.maxWidth}
                                        onMinChange={(v) => setFilters((f) => ({ ...f, minWidth: v }))}
                                        onMaxChange={(v) => setFilters((f) => ({ ...f, maxWidth: v }))}
                                    />
                                </FilterPanel>

                                <FilterPanel title="Source · Release" tone="success">
                                    <PillSelect
                                        label="Source path"
                                        value={filters.sourcePath}
                                        options={[
                                            { v: "all", l: "Any" },
                                            { v: "FG", l: "FG" },
                                            { v: "WIP", l: "WIP" },
                                            { v: "FRESH", l: "Fresh" },
                                            { v: "BLOCKED", l: "Blocked" },
                                        ]}
                                        onChange={(v) => setFilters((f) => ({ ...f, sourcePath: v as SourceFilter }))}
                                    />
                                    <PillSelect
                                        label="Release state"
                                        value={filters.release}
                                        options={[
                                            { v: "all", l: "Any" },
                                            { v: "ready", l: "Ready" },
                                            { v: "blocked", l: "Blocked" },
                                            { v: "artwork", l: "Artwork" },
                                        ]}
                                        onChange={(v) => setFilters((f) => ({ ...f, release: v as ReleaseFilter }))}
                                    />
                                    <PillSelect
                                        label="Lifecycle"
                                        value={filters.lifecycle}
                                        options={[
                                            { v: "all", l: "Any" },
                                            { v: "partial_replan", l: "Partial replan" },
                                            { v: "partial_dispatchable", l: "Partial + ship" },
                                        ]}
                                        onChange={(v) => setFilters((f) => ({ ...f, lifecycle: v as LifecycleFilter }))}
                                    />
                                </FilterPanel>

                                <FilterPanel title="Age · Due" tone="warn">
                                    <PillSelect
                                        label="Days since placed"
                                        value={filters.age}
                                        options={[
                                            { v: "all", l: "Any" },
                                            { v: "0-3d", l: "0-3" },
                                            { v: "4-7d", l: "4-7" },
                                            { v: "8-14d", l: "8-14" },
                                            { v: "15-30d", l: "15-30" },
                                            { v: "30+d", l: "30+" },
                                        ]}
                                        onChange={(v) => setFilters((f) => ({ ...f, age: v as AgeFilter }))}
                                    />
                                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 6, padding: "6px 10px", background: filters.overdueOnly ? "rgba(244,63,94,.10)" : "var(--surface-2)", borderRadius: "var(--r-2)", border: `1px solid ${filters.overdueOnly ? "rgba(244,63,94,.24)" : "var(--border-soft)"}` }}>
                                        <input
                                            type="checkbox"
                                            checked={filters.overdueOnly}
                                            onChange={(e) => setFilters((f) => ({ ...f, overdueOnly: e.target.checked }))}
                                            style={{ width: 14, height: 14, accentColor: "var(--danger)" }}
                                        />
                                        <span style={{ fontSize: 11, fontWeight: 600, color: filters.overdueOnly ? "var(--danger)" : "var(--text-2)" }}>
                                            Overdue only
                                        </span>
                                    </label>
                                </FilterPanel>
                            </div>

                            {activeFilterCount > 0 && (
                                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                                        Showing <strong style={{ color: "var(--text-1)", fontFamily: "var(--f-mono)" }}>{filtered.length}</strong> of {orders.length} orders ·{" "}
                                        <strong style={{ color: "var(--text-1)", fontFamily: "var(--f-mono)" }}>{activeFilterCount}</strong> filter{activeFilterCount === 1 ? "" : "s"} active
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                                        <X size={12} style={{ marginRight: 4 }} />
                                        Clear all
                                    </Button>
                                </div>
                            )}
                        </>
                    );
                })()}
            </Card>

            {/* Rebalanced grid: queue gets equal share, detail panel uses internal 2-col layout for density */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18 }}>
                <Card style={{ padding: 0 }}>
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                            <div className="t-eyebrow">Queue</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                                {filtered.length} order{filtered.length === 1 ? "" : "s"}
                            </div>
                        </div>
                        <ClipboardList size={16} color="var(--text-3)" />
                    </div>
                    {hubQ.isLoading ? (
                        <div style={{ padding: 32, textAlign: "center", color: "var(--text-4)" }}>Loading…</div>
                    ) : filtered.length === 0 ? (
                        <EmptyState title="No orders match these filters" body="Clear filters or widen the date range to see more results." />
                    ) : (
                        <div style={{ maxHeight: 880, overflowY: "auto" }}>
                            {filtered.map((o) => (
                                <QueueRow
                                    key={plannerRowKey(o)}
                                    order={o}
                                    selected={selected ? plannerRowKey(selected) === plannerRowKey(o) : false}
                                    onSelect={() => setSelectedKey(plannerRowKey(o))}
                                />
                            ))}
                        </div>
                    )}
                </Card>

                <div>
                    {selectedDetail ? (
                        <OrderDetailPanel
                            order={selectedDetail}
                            loadingDetail={selectedDetailQ.isFetching && !selectedDetailQ.data?.detail_order}
                            onOpenRelease={() => setReleaseDialogOrder(selectedDetail)}
                            onOpenArtwork={() => setArtworkDialogOrder(selectedDetail)}
                            onInvalidate={invalidateAll}
                        />
                    ) : (
                        <Card>
                            <EmptyState title="Select an order" body="Pick a row from the queue to view its spec, route, sourcing, and release controls." />
                        </Card>
                    )}
                </div>
            </div>

            <InventorySelectDialog
                order={releaseDialogOrder}
                onClose={() => setReleaseDialogOrder(null)}
                onCommitted={invalidateAll}
            />
            <ArtworkPickerDialog order={artworkDialogOrder} onClose={() => setArtworkDialogOrder(null)} />
        </div>
    );
}

function inputStyle(paddingLeft = "10px"): React.CSSProperties {
    return {
        width: "100%", padding: `8px 10px 8px ${paddingLeft}`,
        fontSize: 12, fontFamily: "var(--f-ui)", color: "var(--text-1)",
        background: "var(--surface-1)", border: "1px solid var(--border-soft)",
        borderRadius: "var(--r-2)", outline: "none",
    };
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)", marginBottom: 4 }}>
                {label}
            </div>
            {children}
        </div>
    );
}

// ----- Filter primitives -----

function QuickPill({ label, count, active, onClick, tone }: {
    label: string; count: number; active: boolean; onClick: () => void;
    tone: "brand" | "success" | "danger" | "warn" | "info";
}) {
    const colors = {
        brand: { fg: "var(--br-700)", bg: "var(--br-50)", border: "var(--br-200)" },
        success: { fg: "var(--e-700)", bg: "rgba(16,185,129,.10)", border: "rgba(16,185,129,.22)" },
        danger: { fg: "var(--r-700)", bg: "rgba(244,63,94,.08)", border: "rgba(244,63,94,.20)" },
        warn: { fg: "var(--a-700)", bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.20)" },
        info: { fg: "var(--s-700)", bg: "rgba(14,165,233,.08)", border: "rgba(14,165,233,.20)" },
    }[tone];
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 600,
                background: active ? colors.bg : "var(--surface-1)",
                color: active ? colors.fg : "var(--text-2)",
                border: `1px solid ${active ? colors.fg : "var(--border-soft)"}`,
                borderRadius: "var(--r-pill)",
                cursor: "pointer",
                boxShadow: active ? `0 0 0 3px ${colors.bg}` : "none",
                transition: "all var(--df) var(--eo)",
            }}
        >
            <span>{label}</span>
            <span style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                fontWeight: 700,
                padding: "1px 7px",
                borderRadius: "var(--r-pill)",
                background: active ? "rgba(255,255,255,.7)" : "var(--surface-2)",
                color: active ? colors.fg : "var(--text-3)",
            }}>
                {count}
            </span>
        </button>
    );
}

function FilterPanel({ title, tone, children }: {
    title: string; tone: "brand" | "info" | "success" | "warn"; children: React.ReactNode;
}) {
    const colors = {
        brand: "var(--br-600)",
        info: "var(--s-700)",
        success: "var(--e-700)",
        warn: "var(--a-700)",
    }[tone];
    return (
        <div style={{
            padding: "12px 14px",
            background: "var(--surface-2)",
            borderRadius: "var(--r-3)",
            border: "1px solid var(--border-soft)",
            display: "flex", flexDirection: "column", gap: 10,
        }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 9, fontWeight: 800,
                textTransform: "uppercase", letterSpacing: ".08em",
                color: colors,
            }}>
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: colors }} />
                {title}
            </div>
            {children}
        </div>
    );
}

function PillSelect({ label, value, options, onChange }: {
    label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void;
}) {
    return (
        <div>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)", marginBottom: 4 }}>
                {label}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {options.map((o) => {
                    const active = o.v === value;
                    return (
                        <button
                            key={o.v}
                            type="button"
                            onClick={() => onChange(o.v)}
                            style={{
                                padding: "4px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                background: active ? "var(--brand-600)" : "var(--surface-1)",
                                color: active ? "var(--text-on-brand)" : "var(--text-2)",
                                border: `1px solid ${active ? "var(--brand-600)" : "var(--border-soft)"}`,
                                borderRadius: "var(--r-pill)",
                                cursor: "pointer",
                                transition: "all var(--df) var(--eo)",
                            }}
                        >
                            {o.l}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function NativeSelect({ label, value, options, onChange }: {
    label: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
    return (
        <div>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)", marginBottom: 4 }}>
                {label}
            </div>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: 12,
                    fontFamily: "var(--f-ui)",
                    color: "var(--text-1)",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "var(--r-2)",
                    outline: "none",
                    cursor: "pointer",
                }}
            >
                {options.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                ))}
            </select>
        </div>
    );
}

function RangeRow({ label, minValue, maxValue, onMinChange, onMaxChange }: {
    label: string;
    minValue: string;
    maxValue: string;
    onMinChange: (v: string) => void;
    onMaxChange: (v: string) => void;
}) {
    return (
        <div>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)", marginBottom: 4 }}>
                {label}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                    type="number"
                    value={minValue}
                    onChange={(e) => onMinChange(e.target.value)}
                    placeholder="min"
                    style={{ ...inputStyle(), padding: "7px 10px", fontSize: 11, fontFamily: "var(--f-mono)" }}
                />
                <span style={{ color: "var(--text-4)", fontSize: 10 }}>→</span>
                <input
                    type="number"
                    value={maxValue}
                    onChange={(e) => onMaxChange(e.target.value)}
                    placeholder="max"
                    style={{ ...inputStyle(), padding: "7px 10px", fontSize: 11, fontFamily: "var(--f-mono)" }}
                />
            </div>
        </div>
    );
}

// ----------------- Queue row -----------------

function QueueRow({ order: o, selected, onSelect }: { order: PlannerControlOrder; selected: boolean; onSelect: () => void }) {
    const segments = deriveSegments(o);
    const due = dueInfo((o as any).delivery_date);
    const age = ageInfo((o as any).created_at);
    const fgType = String(o.fg_type || o.final_product_type || "—");
    const factSheet: any = o.order_fact_sheet || {};
    const blockerCount = ((o as any).blockers as any[] | undefined)?.length || 0;
    const fgAvail = !!o.source_availability?.has_fg;
    const wipAvail = !!o.source_availability?.has_wip;
    const sourceTag: { label: string; bg: string; fg: string } = blockerCount > 0
        ? { label: "BLOCKED", bg: "rgba(244,63,94,.14)", fg: "var(--r-700)" }
        : fgAvail
        ? { label: "FG MATCH", bg: "rgba(16,185,129,.14)", fg: "var(--e-700)" }
        : wipAvail
        ? { label: "WIP", bg: "rgba(99,102,241,.14)", fg: "var(--i-700)" }
        : { label: "FRESH", bg: "rgba(37,99,235,.10)", fg: "var(--br-700)" };

    const ageColor = age ? ageToneColor(age.tone) : null;
    const dueColor = dueToneColor(due.tone);
    const isPartial = isPartialReplanRow(o);
    const dispatchableQty = Number(o.qty_dispatchable || 0);
    const replanKg = Number(o.qty_replan_remaining_kg || o.partial_shortfall_kg || 0);

    return (
        <button
            type="button" onClick={onSelect}
            data-testid={`planner-queue-row-${plannerRowKey(o)}`}
            style={{
                width: "100%", textAlign: "left",
                padding: "14px 18px",
                background: selected ? "linear-gradient(90deg, var(--br-50) 0%, var(--surface-1) 100%)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-soft)",
                cursor: "pointer", transition: "background var(--df) var(--eo)",
                position: "relative",
            }}
        >
            {selected && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--brand-600)" }} />}

            {/* Top row: order number + chips + qty */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0, flex: 1 }}>
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
                        {o.order_number}
                    </span>
                    <Chip kind={fgType.toLowerCase().includes("roll") ? "fg-roll" : "fg-pouch"}>{fgType}</Chip>
                    <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 8px",
                        borderRadius: "var(--r-pill)",
                        background: sourceTag.bg, color: sourceTag.fg,
                    }}>
                        {sourceTag.label}
                    </span>
                    {o.line_status_display && (
                        <span style={{
                            fontSize: 9, fontWeight: 800, padding: "2px 8px",
                            borderRadius: "var(--r-pill)",
                            background: "var(--surface-2)", color: "var(--text-2)",
                            border: "1px solid var(--border-soft)",
                        }}>
                            {o.line_status_display}
                        </span>
                    )}
                    {isPartial && (
                        <span style={{
                            fontSize: 9, fontWeight: 800, padding: "2px 8px",
                            borderRadius: "var(--r-pill)",
                            background: "rgba(245,158,11,.14)",
                            color: "var(--warning)",
                            border: "1px solid rgba(245,158,11,.24)",
                        }}>
                            Ship {fmt(dispatchableQty, 1)} · Replan {fmt(replanKg, 1)} KG
                        </span>
                    )}
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{
                        fontFamily: "var(--f-display)",
                        fontSize: 16,
                        fontWeight: 700,
                        color: "var(--text-1)",
                        lineHeight: 1,
                    }}>
                        {fmt(o.required_qty_kg, 0)}
                        <span style={{ fontSize: 9, fontWeight: 600, color: "var(--text-3)", marginLeft: 2 }}>KG</span>
                    </div>
                </div>
            </div>

            {/* Customer + spec */}
            {(o as any).customer_name && (
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 2 }}>
                    {(o as any).customer_name}
                </div>
            )}
            {o.line_label && (
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-1)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.line_label}
                </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {factSheet.profile_label || o.display_geometry_label || `${fmt(o.effective_dims?.width_mm)}×${fmt(o.effective_dims?.height_mm)} mm`}
            </div>

            {/* Age + due dual-pill row — planner mental model */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                {age && ageColor && (
                    <span title="Days since order placed" style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 8px",
                        fontSize: 10, fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: ".04em",
                        borderRadius: "var(--r-pill)",
                        background: ageColor.bg, color: ageColor.fg,
                    }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: ageColor.bgSolid }} />
                        Placed {age.label}
                    </span>
                )}
                {Number.isFinite(due.days) && (
                    <span title="Delivery due date" style={{
                        padding: "2px 8px",
                        fontSize: 10, fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: ".04em",
                        borderRadius: "var(--r-pill)",
                        background: dueColor.bg, color: dueColor.fg,
                    }}>
                        {due.label}
                    </span>
                )}
            </div>

            <HealthBar segments={segments} />
        </button>
    );
}

// ----------------- Order detail panel -----------------

function OrderDetailPanel({ order, loadingDetail = false, onOpenRelease, onOpenArtwork, onInvalidate }: {
    order: PlannerControlOrder;
    loadingDetail?: boolean;
    onOpenRelease: () => void;
    onOpenArtwork: () => void;
    onInvalidate: () => void;
}) {
    const { toast } = useToast();
    const segments = deriveSegments(order);
    const fgType = String(order.fg_type || order.final_product_type || "—");
    const due = dueLabel((order as any).delivery_date);
    const blockers = ((order as any).blockers as any[] | undefined) || [];
    const artworkRequired = !!order.artwork_assignment_required;
    const artworkAssigned = !!order.assigned_artwork_id;
    const mathOk = order.math_valid !== false;
    const fgAvail = !!order.source_availability?.has_fg;
    const wipAvail = !!order.source_availability?.has_wip;
    const releaseReady = mathOk && (!artworkRequired || artworkAssigned) && blockers.length === 0;

    const factSheet: any = order.order_fact_sheet || {};
    const printingSnap = order.printing_snapshot || {};
    const packagingSnap = order.packaging_snapshot || {};
    const addons: any[] = Array.isArray(order.addons_snapshot) ? order.addons_snapshot : [];
    const layerSnap: any[] = Array.isArray(order.layer_snapshot) ? order.layer_snapshot : [];
    const templateSteps: any[] = Array.isArray(order.template_steps) ? order.template_steps : [];
    const materialPlan: any[] = Array.isArray(order.material_plan_lines) ? order.material_plan_lines : [];
    const inventoryOptions: PlannerInventoryOption[] = Array.isArray(order.inventory_options) ? order.inventory_options : [];
    const fgOptions = inventoryOptions.filter(isExactFgOption);
    const wipOptions = inventoryOptions.filter(isReusableRollOption);
    const matchingStockOrders = (order.matching_stock_orders || []) as any[];
    const actionRec = (order as any).action_recommendation as { title?: string; description?: string; tone?: string } | undefined;
    const pendingArtworkItems = order.pending_artwork_items || [];
    const [resolutionMode, setResolutionMode] = useState<"cancel" | "short-close" | null>(null);
    const [resolutionReason, setResolutionReason] = useState("");
    const lineStatus = String(order.line_status || "").toUpperCase();
    const isSalesLine = order.order_kind === "sales" && !!order.sales_order_item_id;
    const lineClosed = ["CANCELLED", "SHORT_CLOSED", "COMPLETED"].includes(lineStatus);
    const hasPartialShortfall = Number(order.partial_shortfall_kg || 0) > 0 || lineStatus === "PARTIAL";
    const canCancelLine = isSalesLine && !lineClosed;
    const canShortCloseLine = isSalesLine && !lineClosed && (hasPartialShortfall || Number(order.qty_open || 0) > 0);

    const cancelLineMutation = useMutation({
        mutationFn: async () => {
            if (!order.sales_order_item_id) throw new Error("No sales order line selected.");
            return plannerService.cancelPlannedLine(order.order_kind as PlannerOrderKind, order.order_id, {
                item_id: order.sales_order_item_id,
                reason: resolutionReason.trim(),
            });
        },
        onSuccess: () => {
            toast({ title: "Line cancelled", description: order.line_label || order.display_name || order.order_number });
            setResolutionMode(null);
            setResolutionReason("");
            onInvalidate();
        },
        onError: (err: any) => {
            toast({
                title: "Cancel failed",
                description: err?.response?.data?.error || err?.response?.data?.detail || err?.message || "Use short-close if the line has machine activity.",
                variant: "destructive",
            });
        },
    });

    const shortCloseMutation = useMutation({
        mutationFn: async () => {
            if (!order.sales_order_item_id) throw new Error("No sales order line selected.");
            return plannerService.shortCloseOrder(order.order_kind as PlannerOrderKind, order.order_id, {
                item_id: order.sales_order_item_id,
                reason: resolutionReason.trim(),
            });
        },
        onSuccess: () => {
            toast({ title: "Line short-closed", description: order.line_label || order.display_name || order.order_number });
            setResolutionMode(null);
            setResolutionReason("");
            onInvalidate();
        },
        onError: (err: any) => {
            toast({
                title: "Short-close failed",
                description: err?.response?.data?.error || err?.response?.data?.detail || err?.message || "Try again.",
                variant: "destructive",
            });
        },
    });

    const submitResolution = () => {
        if (resolutionReason.trim().length < 5) {
            toast({ title: "Reason required", description: "Enter at least 5 characters.", variant: "destructive" });
            return;
        }
        if (resolutionMode === "cancel") cancelLineMutation.mutate();
        if (resolutionMode === "short-close") shortCloseMutation.mutate();
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 12 }}>
            {loadingDetail && (
                <div style={{
                    padding: "8px 12px",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "var(--r-2)",
                    background: "var(--surface-2)",
                    color: "var(--text-3)",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                }}>
                    Loading full sourcing detail…
                </div>
            )}
            {/* Hero with order header */}
            <Card style={{ padding: 0, overflow: "hidden" }}>
                <div style={{
                    padding: "20px 22px",
                    background: "linear-gradient(135deg, var(--br-50) 0%, var(--i-50) 100%)",
                    borderBottom: "1px solid var(--border-soft)",
                }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                <Sparkles size={11} color="var(--br-700)" />
                                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--br-700)" }}>
                                    Order detail
                                </span>
                            </div>
                            <div style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 700, color: "var(--text-1)", lineHeight: 1.15 }}>
                                {factSheet.display_name || order.order_number}
                            </div>
                            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                                {order.order_number}{(order as any).customer_name ? ` · ${(order as any).customer_name}` : ""}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                                <Chip kind={fgType.toLowerCase().includes("roll") ? "fg-roll" : "fg-pouch"}>{fgType}</Chip>
                                {factSheet.profile_label && <Chip kind="size">{factSheet.profile_label}</Chip>}
                                {factSheet.print_profile_label && Number(factSheet.front_colors_count || 0) > 0 && (
                                    <Chip kind="print">{factSheet.print_profile_label}</Chip>
                                )}
                                {/* Explicit print-state chip so planner sees release-ability + ink state at a glance.
                                    - artwork required + assigned   → "ready"   "Artwork ✓"
                                    - artwork required + missing    → "blocked" "Artwork REQUIRED · cannot release"
                                    - artwork optional + assigned   → "ready"   "Artwork ✓"
                                    - artwork optional + missing    → "paused"  "Warning print · zero ink in BOM" (releasable)
                                    Skip when printing is OFF entirely. */}
                                {(() => {
                                    const printingOn = Boolean((printingSnap as any)?.enabled) || Number(factSheet.front_colors_count || 0) > 0 || Boolean((order as any).print_capable)
                                    if (!printingOn) return null
                                    if (artworkAssigned) {
                                        return <Chip kind="ready">Artwork ✓</Chip>
                                    }
                                    if (artworkRequired) {
                                        return <Chip kind="blocked">Artwork REQUIRED · cannot release</Chip>
                                    }
                                    return <Chip kind="paused">Warning print · zero ink in BOM</Chip>
                                })()}
                                <Chip kind="tpl">{order.template_name}</Chip>
                            </div>
                        </div>
                        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                            {/* PROMINENT: Placed date — company works on "days since order placed", not due date */}
                            {(() => {
                                const placedAt = (order as any).created_at || (order as any).order_created_at;
                                if (!placedAt) return null;
                                const age = ageInfo(placedAt);
                                const c = age ? ageToneColor(age.tone) : null;
                                const placedDate = new Date(placedAt);
                                if (Number.isNaN(placedDate.getTime())) return null;
                                return (
                                    <>
                                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-4)" }}>
                                            Order placed
                                        </div>
                                        <div style={{
                                            fontFamily: "var(--f-display)",
                                            fontSize: 18,
                                            fontWeight: 700,
                                            color: "var(--text-1)",
                                            lineHeight: 1.1,
                                        }}>
                                            {formatDisplayDate(placedDate)}
                                        </div>
                                        {age && c && (
                                            <span style={{
                                                display: "inline-flex", alignItems: "center", gap: 5,
                                                padding: "3px 10px",
                                                fontSize: 11, fontWeight: 800,
                                                textTransform: "uppercase", letterSpacing: ".05em",
                                                borderRadius: "var(--r-pill)",
                                                background: c.bg, color: c.fg,
                                            }}>
                                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.bgSolid }} />
                                                {age.days === 0 ? "Today" : age.label}
                                            </span>
                                        )}
                                    </>
                                );
                            })()}
                            {/* Demoted: due date as small muted reference */}
                            {(order as any).delivery_date && (
                                <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-4)", fontFamily: "var(--f-mono)" }}>
                                    {due.label} · due {formatDisplayDate((order as any).delivery_date)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Action recommendation banner */}
                {actionRec?.title && (
                    <div style={{
                        padding: "10px 22px",
                        background: actionRec.tone === "critical"
                            ? "rgba(244,63,94,.08)"
                            : actionRec.tone === "warning"
                            ? "rgba(245,158,11,.08)"
                            : "var(--surface-2)",
                        borderBottom: "1px solid var(--border-soft)",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                    }}>
                        <Zap size={14} color={actionRec.tone === "critical" ? "var(--danger)" : actionRec.tone === "warning" ? "var(--warning)" : "var(--br-700)"} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>{actionRec.title}</div>
                            {actionRec.description && (
                                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{actionRec.description}</div>
                            )}
                        </div>
                    </div>
                )}

                {/* Quantity strip */}
                <div style={{ padding: "16px 22px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
                    <BigStat label="Required" value={fmt(order.required_qty_kg, 1)} suffix="KG" tone="info" />
                    {Number(order.qty_dispatchable || 0) > 0 && (
                        <BigStat label="Dispatchable" value={fmt(order.qty_dispatchable, 1)} suffix={order.qty_uom || ""} tone="success" />
                    )}
                    {hasPartialShortfall && Number(order.qty_replan_remaining_kg || order.partial_shortfall_kg || 0) > 0 && (
                        <BigStat label="Replan" value={fmt(order.qty_replan_remaining_kg || order.partial_shortfall_kg, 1)} suffix="KG" tone="warn" />
                    )}
                    {order.required_qty_pcs != null && (
                        <BigStat label="Pieces" value={fmt(order.required_qty_pcs, 0)} suffix="PCS" tone="default" />
                    )}
                    {order.unit_weight_g != null && (
                        <BigStat label="Unit weight" value={fmt(order.unit_weight_g, 2)} suffix="g" tone="default" />
                    )}
                    {factSheet.partial_shortfall_kg != null && Number(factSheet.partial_shortfall_kg) > 0 && (
                        <BigStat label="Shortfall" value={fmt(factSheet.partial_shortfall_kg, 1)} suffix="KG" tone="danger" />
                    )}
                    {hasPartialShortfall && Number(order.qty_dispatchable || 0) > 0 && (
                        <BigStat label="Dispatchable" value={fmt(order.qty_dispatchable, 1)} suffix={order.qty_uom || "KG"} tone="success" />
                    )}
                </div>
            </Card>

            {isSalesLine && (
                <Card style={{ borderColor: hasPartialShortfall ? "rgba(245,158,11,.35)" : "var(--border-soft)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="t-eyebrow">Sales line lifecycle</div>
                            <div style={{ marginTop: 5, fontSize: 15, fontWeight: 800, color: "var(--text-1)" }}>
                                {order.line_label || order.display_name || order.order_number}
                            </div>
                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                                <Chip kind={lineClosed ? "blocked" : hasPartialShortfall ? "paused" : "ready"}>
                                    {order.line_status_display || lineStatus || "Line status"}
                                </Chip>
                                <Chip kind="size">Open {fmt(order.qty_open, 2)} {order.qty_uom || "KG"}</Chip>
                                {Number(order.qty_dispatchable || 0) > 0 && (
                                    <Chip kind="ready">Dispatchable {fmt(order.qty_dispatchable, 2)} {order.qty_uom || ""}</Chip>
                                )}
                                {hasPartialShortfall && Number(order.qty_replan_remaining_kg || order.partial_shortfall_kg || 0) > 0 && (
                                    <Chip kind="paused">Replan {fmt(order.qty_replan_remaining_kg || order.partial_shortfall_kg, 2)} KG</Chip>
                                )}
                                {Number(order.qty_dispatched || 0) > 0 && <Chip kind="ready">Dispatched {fmt(order.qty_dispatched, 2)}</Chip>}
                                {Number(order.qty_short_closed || 0) > 0 && <Chip kind="paused">Short closed {fmt(order.qty_short_closed, 2)}</Chip>}
                                {Number(order.qty_cancelled || 0) > 0 && <Chip kind="blocked">Cancelled {fmt(order.qty_cancelled, 2)}</Chip>}
                            </div>
                            {hasPartialShortfall && (
                                <div style={{ marginTop: 8, fontSize: 11, color: "var(--warning)", fontWeight: 700 }}>
                                    Final step produced {fmt(order.partial_produced_kg, 1)} KG of {fmt(order.partial_target_kg, 1)} KG. Dispatch can ship {fmt(order.qty_dispatchable, 2)} {order.qty_uom || ""} now; Planner keeps {fmt(order.qty_replan_remaining_kg || order.partial_shortfall_kg, 1)} KG for re-release or short-close.
                                </div>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <Button
                                variant="warn"
                                size="sm"
                                disabled={!canShortCloseLine || shortCloseMutation.isPending || cancelLineMutation.isPending}
                                onClick={() => {
                                    setResolutionMode("short-close");
                                    setResolutionReason("");
                                }}
                            >
                                <PauseCircle size={13} style={{ marginRight: 6 }} />
                                Short close
                            </Button>
                            <Button
                                variant="danger"
                                size="sm"
                                disabled={!canCancelLine || shortCloseMutation.isPending || cancelLineMutation.isPending}
                                onClick={() => {
                                    setResolutionMode("cancel");
                                    setResolutionReason("");
                                }}
                            >
                                <X size={13} style={{ marginRight: 6 }} />
                                Cancel line
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Two-column inner layout: Spec (left) + Sourcing (right) */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
                {/* Spec card */}
                <Card>
                    <div className="t-eyebrow" style={{ marginBottom: 12 }}>Specification</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <SpecBlock
                            icon={<Settings2 size={13} />}
                            label="Geometry"
                            primary={factSheet.profile_label || order.display_geometry_label || `${fmt(order.effective_dims?.width_mm)}×${fmt(order.effective_dims?.height_mm)} mm`}
                            secondary={order.spec_signature ? `Spec ${order.spec_signature.slice(0, 10)}…` : undefined}
                        />

                        {/* Layers — structured */}
                        {layerSnap.length > 0 && (
                            <div>
                                <SpecLabel icon={<LayersIcon size={13} />}>Layers ({layerSnap.length})</SpecLabel>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                                    {layerSnap.map((lay, i) => <LayerRow key={i} layer={lay} />)}
                                </div>
                            </div>
                        )}

                        {(printingSnap?.print_type || (factSheet.front_colors_count != null && factSheet.front_colors_count > 0)) && (
                            <SpecBlock
                                icon={<Printer size={13} />}
                                label="Printing"
                                primary={
                                    factSheet.print_profile_label ||
                                    (order.display_printing_label as string | undefined) ||
                                    `${printingSnap?.print_type || "FLEXO"} · ${printingSnap?.front_colors_count || 0} colors`
                                }
                                secondary={((order as any).ink_base_family || printingSnap?.ink_base_family) ? `Ink family ${((order as any).ink_base_family || printingSnap.ink_base_family)}` : undefined}
                            />
                        )}

                        {addons.length > 0 && (
                            <div>
                                <SpecLabel icon={<Package size={13} />}>Add-ons ({addons.length})</SpecLabel>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                                    {addons.map((a, i) => (
                                        <Chip key={i} kind="pack">
                                            {a.name || a.code || "Add-on"}{a.qty ? ` · ×${a.qty}` : ""}
                                        </Chip>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(order.display_packaging_label || (packagingSnap?.primary_inner_pack?.enabled || packagingSnap?.pod?.enabled)) && (
                            <SpecBlock
                                icon={<Package size={13} />}
                                label="Packaging"
                                primary={
                                    (order.display_packaging_label as string | undefined) ||
                                    [
                                        packagingSnap?.primary_inner_pack?.enabled ? "Primary pack" : null,
                                        packagingSnap?.pod?.enabled ? "POD" : null,
                                        packagingSnap?.roll_dispatch_pack?.enabled ? "Roll dispatch" : null,
                                    ].filter(Boolean).join(" · ") || "Default"
                                }
                            />
                        )}
                    </div>

                    {/* Production route */}
                    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--border-soft)" }}>
                        <SpecLabel>Production route</SpecLabel>
                        {templateSteps.length === 0 ? (
                            <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6, fontStyle: "italic" }}>No route data.</div>
                        ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 8 }}>
                                {templateSteps.map((step: any, i: number) => {
                                    const startIdx = order.required_start_step ?? 0;
                                    const endIdx = order.route_last_step_index ?? templateSteps.length - 1;
                                    const inRange = step.sequence_number >= startIdx && step.sequence_number <= endIdx;
                                    return (
                                        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                            <span style={{
                                                padding: "6px 12px",
                                                background: inRange ? "var(--br-50)" : "var(--surface-2)",
                                                color: inRange ? "var(--br-700)" : "var(--text-3)",
                                                border: `1px solid ${inRange ? "var(--br-400)" : "var(--border-soft)"}`,
                                                borderRadius: "var(--r-2)",
                                                fontSize: 11, fontWeight: 600,
                                                opacity: inRange ? 1 : 0.6,
                                            }}>
                                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, marginRight: 4, color: inRange ? "var(--br-600)" : "var(--text-4)" }}>
                                                    {step.sequence_number}
                                                </span>
                                                {step.process_name || step.step_name || step.process_code}
                                            </span>
                                            {i < templateSteps.length - 1 && <ChevronRight size={11} color="var(--text-4)" />}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </Card>

                {/* Sourcing — actionable matching pool */}
                <Card>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <div className="t-eyebrow">Sourcing</div>
                        <div style={{ display: "flex", gap: 4 }}>
                            <SourceTinyTile label="FG" count={fgOptions.length} active={fgAvail} tone="success" />
                            <SourceTinyTile label="WIP" count={wipOptions.length} active={wipAvail} tone="info" />
                            <SourceTinyTile label="STK" count={matchingStockOrders.length} active={matchingStockOrders.length > 0} tone="brand" />
                        </div>
                    </div>

                    {/* FG matches */}
                    {fgOptions.length > 0 && (
                        <SourceSection title="FG matches" tone="success" count={fgOptions.length}>
                            {fgOptions.slice(0, 4).map((opt) => (
                                <CandidateRow key={`${opt.inventory_type}:${opt.inventory_id}`} option={opt} accentColor="var(--success)" onAllocate={onOpenRelease} />
                            ))}
                            {fgOptions.length > 4 && (
                                <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-4)", textAlign: "center" }}>
                                    +{fgOptions.length - 4} more in selector
                                </div>
                            )}
                        </SourceSection>
                    )}

                    {/* WIP candidates */}
                    {wipOptions.length > 0 && (
                        <SourceSection title="WIP convertible" tone="info" count={wipOptions.length}>
                            {wipOptions.slice(0, 4).map((opt) => (
                                <CandidateRow key={`${opt.inventory_type}:${opt.inventory_id}`} option={opt} accentColor="var(--i-700)" onAllocate={onOpenRelease} />
                            ))}
                            {wipOptions.length > 4 && (
                                <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-4)", textAlign: "center" }}>
                                    +{wipOptions.length - 4} more in selector
                                </div>
                            )}
                        </SourceSection>
                    )}

                    {/* Matching stock orders */}
                    {matchingStockOrders.length > 0 && (
                        <SourceSection title="Matching stock orders" tone="brand" count={matchingStockOrders.length}>
                            {matchingStockOrders.slice(0, 3).map((sm: any, i: number) => (
                                <div key={i} style={{
                                    padding: "8px 10px", marginBottom: 4,
                                    background: "var(--surface-2)", borderRadius: "var(--r-2)",
                                    border: "1px solid var(--border-soft)",
                                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                                }}>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-1)" }}>
                                            {sm.order_number || sm.id}
                                        </div>
                                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
                                            {sm.status || ""}
                                            {sm.target_qty != null ? ` · ${fmt(sm.target_qty, 1)} ${sm.quantity_uom || "KG"}` : ""}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </SourceSection>
                    )}

                    {/* Fresh-only state */}
                    {fgOptions.length === 0 && wipOptions.length === 0 && matchingStockOrders.length === 0 && (
                        <div style={{
                            padding: "14px 16px",
                            background: "linear-gradient(135deg, var(--br-50) 0%, transparent 100%)",
                            border: "1px solid var(--br-200)",
                            borderRadius: "var(--r-3)",
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                        }}>
                            <Rocket size={16} color="var(--br-700)" style={{ marginTop: 1 }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--br-900)" }}>Fresh production run required</div>
                                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                                    No FG or WIP candidates exist for this spec. Releasing will schedule a brand-new run on the {templateSteps.length}-step route.
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Material plan */}
                    {materialPlan.length > 0 && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border-soft)" }}>
                            <SpecLabel icon={<Package size={12} />}>Material plan ({materialPlan.length} lines)</SpecLabel>
                            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                                {materialPlan.slice(0, 6).map((m: any, i: number) => (
                                    <div
                                        key={i}
                                        style={{
                                            padding: "7px 10px", background: "var(--surface-2)",
                                            borderRadius: "var(--r-2)", fontSize: 11,
                                            display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center",
                                        }}
                                    >
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {m.material_name}
                                            </div>
                                            <div style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--text-4)" }}>
                                                {m.material_code} · {m.category_code}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: "right", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                                            <strong>{fmt(m.planned_issue_qty, 3)}</strong> {m.uom}
                                        </div>
                                    </div>
                                ))}
                                {materialPlan.length > 6 && (
                                    <div style={{ fontSize: 10, color: "var(--text-4)", textAlign: "center", padding: 4 }}>
                                        +{materialPlan.length - 6} more lines
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </Card>
            </div>

            {/* Artwork section — only if needed */}
            {artworkRequired && !artworkAssigned && (
                <Card
                    data-testid={`planner-artwork-gate-${order.order_kind}:${order.order_id}`}
                    style={{ borderColor: "var(--warning)" }}
                >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{
                            padding: 8,
                            borderRadius: "var(--r-3)",
                            background: "rgba(245,158,11,.10)",
                        }}>
                            <ImageIcon size={20} color="var(--warning)" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                                <div>
                                    <div className="t-eyebrow" style={{ color: "var(--warning)" }}>Artwork required</div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                                        Pick an artwork before releasing
                                    </div>
                                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                                        {pendingArtworkItems.length > 0
                                            ? `${pendingArtworkItems.length} pending item${pendingArtworkItems.length === 1 ? "" : "s"}`
                                            : "Order item is awaiting artwork assignment"}
                                        {factSheet.print_profile_label ? ` · ${factSheet.print_profile_label}` : ""}
                                    </div>
                                </div>
                                <Button
                                    variant="primary"
                                    data-testid={`planner-open-artwork-picker-${order.order_kind}:${order.order_id}`}
                                    onClick={onOpenArtwork}
                                >
                                    <ImageIcon size={14} style={{ marginRight: 6 }} />
                                    Assign artwork
                                </Button>
                            </div>
                            {pendingArtworkItems.length > 0 && (
                                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {pendingArtworkItems.map((it: any) => (
                                        <Chip key={it.id} kind="brand">{it.label || it.line_name || it.id.slice(0, 8)}</Chip>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </Card>
            )}

            {/* Release Checklist + CTA */}
            <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div className="t-eyebrow">Release checklist</div>
                    <span style={{ fontSize: 10, fontFamily: "var(--f-mono)", color: releaseReady ? "var(--success)" : "var(--text-4)", fontWeight: 700 }}>
                        {releaseReady ? "✓ ALL GREEN" : "REVIEW REQUIRED"}
                    </span>
                </div>
                <div style={{ marginTop: 4, marginBottom: 12 }}>
                    <HealthBar segments={segments} showLabels />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <ChecklistRow ok={mathOk} label="Math validates" detail={mathOk ? "All formulas resolve" : order.math_error || "math invalid"} />
                    <ChecklistRow
                        ok={!artworkRequired || artworkAssigned}
                        label="Artwork ready"
                        detail={!artworkRequired ? "Not required" : artworkAssigned ? "Assigned" : "Pending — assign above"}
                        warning={artworkRequired && !artworkAssigned}
                    />
                    <ChecklistRow
                        ok={blockers.length === 0}
                        label="Material plan"
                        detail={blockers.length === 0 ? `${order.material_plan_summary?.line_count ?? 0} lines, no blockers` : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`}
                    />
                    <ChecklistRow
                        ok
                        label="Route span"
                        detail={`Steps ${order.required_start_step ?? "?"} → ${order.route_last_step_index ?? "?"}`}
                    />
                </div>

                {blockers.length > 0 && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(244,63,94,.06)", border: "1px solid rgba(244,63,94,.16)", borderRadius: "var(--r-3)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--danger)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
                            <AlertTriangle size={12} />
                            Blockers ({blockers.length})
                        </div>
                        {blockers.map((b: any, i: number) => (
                            <div key={i} style={{ fontSize: 12, color: "var(--text-1)", marginTop: i === 0 ? 0 : 4 }}>
                                · {b?.label || b?.message || b?.code || "blocker"}
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "stretch" }}>
                    <Button
                        variant="primary"
                        disabled={!releaseReady}
                        onClick={onOpenRelease}
                        style={{
                            flex: 1,
                            boxShadow: releaseReady ? "var(--glow-brand)" : "none",
                            opacity: releaseReady ? 1 : 0.6,
                        }}
                    >
                        <Rocket size={14} style={{ marginRight: 6 }} />
                        {hasPartialShortfall ? "Re-run remaining" : fgAvail || wipAvail ? "Choose source & release" : "Plan & Release"}
                    </Button>
                </div>
                {!releaseReady && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-4)" }}>
                        Resolve blockers and artwork before release.
                    </div>
                )}
            </Card>
            {resolutionMode && (
                <div
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setResolutionMode(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: "var(--z-modal)" as any,
                        background: "rgba(15,23,42,.42)",
                        backdropFilter: "blur(4px)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 24,
                    }}
                >
                    <div
                        onClick={(event) => event.stopPropagation()}
                        style={{
                            width: "min(520px, 100%)",
                            borderRadius: "var(--r-5)",
                            border: "1px solid var(--border-soft)",
                            background: "var(--surface-1)",
                            boxShadow: "var(--sh-lg)",
                            padding: 20,
                        }}
                    >
                        <div className="t-eyebrow">{resolutionMode === "cancel" ? "Cancel sales line" : "Short-close sales line"}</div>
                        <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "var(--text-1)" }}>
                            {order.line_label || order.display_name || order.order_number}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
                            {resolutionMode === "cancel"
                                ? "Allowed only before machine activity. If the line has started, use short-close."
                                : "Closes the unresolved remaining quantity while preserving produced quantity for dispatch."}
                        </div>
                        <textarea
                            value={resolutionReason}
                            onChange={(event) => setResolutionReason(event.target.value)}
                            placeholder="Reason visible in audit trail"
                            style={{
                                marginTop: 14,
                                width: "100%",
                                minHeight: 96,
                                resize: "vertical",
                                padding: 12,
                                borderRadius: "var(--r-3)",
                                border: "1px solid var(--border-soft)",
                                background: "var(--surface-2)",
                                color: "var(--text-1)",
                                fontSize: 13,
                                outline: "none",
                            }}
                        />
                        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <Button variant="ghost" onClick={() => setResolutionMode(null)}>Close</Button>
                            <Button
                                variant={resolutionMode === "cancel" ? "danger" : "warn"}
                                disabled={cancelLineMutation.isPending || shortCloseMutation.isPending}
                                onClick={submitResolution}
                            >
                                {resolutionMode === "cancel" ? "Cancel line" : "Short close line"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ----------------- Helpers -----------------

function BigStat({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone: "info" | "success" | "warn" | "danger" | "default" }) {
    const colors = {
        info: { fg: "var(--br-700)", bg: "rgba(255,255,255,.6)" },
        success: { fg: "var(--success)", bg: "rgba(16,185,129,.06)" },
        warn: { fg: "var(--warning)", bg: "rgba(245,158,11,.06)" },
        danger: { fg: "var(--danger)", bg: "rgba(244,63,94,.06)" },
        default: { fg: "var(--text-1)", bg: "rgba(255,255,255,.6)" },
    }[tone];
    return (
        <div style={{ padding: "10px 12px", background: colors.bg, borderRadius: "var(--r-3)", border: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)" }}>
                {label}
            </div>
            <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 700, color: colors.fg, lineHeight: 1 }}>
                    {value}
                </span>
                {suffix && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)" }}>{suffix}</span>}
            </div>
        </div>
    );
}

function SpecLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)" }}>
            {icon && <span style={{ color: "var(--text-3)" }}>{icon}</span>}
            <span>{children}</span>
        </div>
    );
}

function SpecBlock({ icon, label, primary, secondary }: { icon: React.ReactNode; label: string; primary: string; secondary?: string }) {
    return (
        <div>
            <SpecLabel icon={icon}>{label}</SpecLabel>
            <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{primary}</div>
            {secondary && <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2, fontFamily: "var(--f-mono)" }}>{secondary}</div>}
        </div>
    );
}

function LayerRow({ layer }: { layer: any }) {
    // Parse useful fields from layer_snapshot row
    const name = layer.name || `Layer`;
    const thickness = layer.thickness_micron ?? layer.thickness;
    const widthMm = layer.width_mm ?? layer.roll_width_mm;
    const density = layer.density_g_cm3 ?? layer.density;
    // Try to derive material code + grade from name (e.g. "Codex PET 12u purchased print web" → PET)
    const upper = String(name).toUpperCase();
    const materialCode = ["BOPET", "BOPP", "LLDPE", "LDPE", "HDPE", "PET", "POLY", "PVC", "PA"].find((c) => upper.includes(c)) || null;
    const grade = layer.grade || layer.grade_id || null;
    return (
        <div style={{
            padding: "10px 12px",
            background: "var(--surface-2)",
            borderRadius: "var(--r-3)",
            borderLeft: "3px solid var(--br-400)",
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {name}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {materialCode && <Chip kind="mat">{materialCode}</Chip>}
                        {grade && <Chip kind="grade">{grade}</Chip>}
                        {widthMm != null && <Chip kind="size">{fmt(widthMm)} mm</Chip>}
                    </div>
                </div>
                {thickness != null && (
                    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{
                            fontFamily: "var(--f-mono)",
                            fontSize: 16, fontWeight: 700,
                            color: "var(--br-700)",
                            lineHeight: 1,
                        }}>
                            {Number(thickness).toFixed(thickness % 1 === 0 ? 0 : 2)}
                            <span style={{ fontSize: 11, marginLeft: 1 }}>μ</span>
                        </div>
                        {density != null && (
                            <div style={{ fontSize: 9, color: "var(--text-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>
                                ρ {Number(density).toFixed(2)}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function SourceTinyTile({ label, count, active, tone }: { label: string; count: number; active: boolean; tone: "success" | "info" | "brand" }) {
    const colors = {
        success: { bg: "rgba(16,185,129,.12)", fg: "var(--success)" },
        info: { bg: "rgba(99,102,241,.12)", fg: "var(--i-700)" },
        brand: { bg: "rgba(37,99,235,.10)", fg: "var(--br-700)" },
    }[tone];
    return (
        <div style={{
            padding: "3px 8px",
            background: active ? colors.bg : "var(--surface-2)",
            color: active ? colors.fg : "var(--text-4)",
            border: `1px solid ${active ? colors.fg : "var(--border-soft)"}`,
            borderRadius: "var(--r-pill)",
            fontSize: 9, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: ".06em",
            display: "inline-flex", alignItems: "center", gap: 4,
            opacity: active ? 1 : 0.6,
        }}>
            <span>{label}</span>
            <span style={{ fontFamily: "var(--f-mono)" }}>{count}</span>
        </div>
    );
}

function SourceSection({ title, tone, count, children }: { title: string; tone: "success" | "info" | "brand"; count: number; children: React.ReactNode }) {
    const accent = {
        success: "var(--success)",
        info: "var(--i-700)",
        brand: "var(--br-700)",
    }[tone];
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{
                fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: ".06em",
                color: accent,
                marginBottom: 6,
            }}>
                {title} <span style={{ fontFamily: "var(--f-mono)", color: "var(--text-3)" }}>· {count}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {children}
            </div>
        </div>
    );
}

function CandidateRow({ option, accentColor, onAllocate }: { option: PlannerInventoryOption; accentColor: string; onAllocate: () => void }) {
    const matchLabel = [
        option.source_label,
        option.family_display_name,
        option.size_line,
        option.process_state_label,
        widthMatchLabel(option),
    ].filter(Boolean).join(" · ");
    return (
        <div style={{
            padding: "8px 10px",
            background: "var(--surface-1)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--r-2)",
            display: "flex", alignItems: "center", gap: 8,
        }}>
            <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: accentColor }} />
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {option.display_name || option.label}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {matchLabel}
                </div>
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-1)" }}>
                    {fmt(option.allocatable_qty_kg, 1)} KG
                </div>
                <div style={{ fontSize: 9, color: "var(--text-4)", fontFamily: "var(--f-mono)" }}>
                    of {fmt(option.quantity_kg, 1)}
                </div>
            </div>
            <button
                type="button"
                onClick={onAllocate}
                style={{
                    fontSize: 10, fontWeight: 700,
                    padding: "5px 10px",
                    border: `1px solid ${accentColor}`,
                    background: "transparent",
                    color: accentColor,
                    borderRadius: "var(--r-pill)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all var(--df) var(--eo)",
                }}
                title="Open release dialog with this candidate pre-selected"
            >
                ALLOCATE
            </button>
        </div>
    );
}

function ChecklistRow({ ok, label, detail, warning }: { ok: boolean; label: string; detail: string; warning?: boolean }) {
    const tone = ok ? "ok" : warning ? "warn" : "danger";
    const icon = tone === "ok" ? <CheckCircle2 size={14} color="var(--success)" /> : <AlertTriangle size={14} color={tone === "warn" ? "var(--warning)" : "var(--danger)"} />;
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
            background: tone === "ok" ? "rgba(16,185,129,.06)" : tone === "warn" ? "rgba(245,158,11,.06)" : "rgba(244,63,94,.06)",
            borderRadius: "var(--r-2)", fontSize: 12,
        }}>
            {icon}
            <span style={{ fontWeight: 600, color: "var(--text-1)" }}>{label}</span>
            <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11 }}>{detail}</span>
        </div>
    );
}
