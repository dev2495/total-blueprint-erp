"use client";

import type React from "react";
import { Activity, Boxes, Clock, Layers, Package, Printer, Route, Ruler, Scale, Workflow } from "lucide-react";

import { Chip } from "@/components/_planner-ui";
import type { ChipKind } from "@/components/_planner-ui/Chip";
import type { PlannerControlOrder, PlannerProductionRouteStep, PlannerProductionTrace, PlannerRouteTopologyLane } from "@/services/planner";
import { formatDisplayDateTime } from "@/lib/date-format";

function fmt(value: unknown, decimals = 0): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function clean(value: unknown): string {
    return String(value ?? "").trim();
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const text = clean(value);
        if (text && text !== "-" && text.toLowerCase() !== "none") return text;
    }
    return "";
}

function titleCase(value: string): string {
    return value
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function numberLabel(value: unknown, decimals = 0): string {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";
    return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

export function getOrderPassport(order: PlannerControlOrder) {
    const spec = order.spec_summary || {};
    const fact: any = order.order_fact_sheet || {};
    const geometry: any = order.geometry_snapshot || {};
    const base = geometry?.base || {};
    const printing: any = order.printing_snapshot || {};
    const packaging: any = order.packaging_snapshot || {};

    const fgType = firstText(order.fg_type, order.final_product_type, fact.fg_type, "ORDER").toUpperCase();
    const productMaster = firstText(
        order.product_master_label,
        order.product_master_code && order.product_master_name
            ? `${order.product_master_code} · ${order.product_master_name}`
            : "",
        order.product_master_code,
        order.product_master_name,
        fact.product_master_code,
        fact.product_master_name,
    );
    const displayName = firstText(order.line_label, fact.display_name, order.display_name, order.template_name, order.order_number);
    const sizeLabel = firstText(
        spec.size_label,
        spec.geometry_label,
        fact.profile_label,
        order.display_geometry_label,
        order.effective_dims?.width_mm && order.effective_dims?.height_mm
            ? `${fmt(order.effective_dims.width_mm)} x ${fmt(order.effective_dims.height_mm)} mm`
            : "",
        geometry.width_mm && geometry.height_mm ? `${fmt(geometry.width_mm)} x ${fmt(geometry.height_mm)} mm` : "",
    );
    const pouchStyle = firstText(geometry.pouch_style, base.pouch_style, geometry.pouch_style_code, fact.profile_kind);
    const rollForm = firstText(fact.roll_form, geometry.roll_form, base.roll_form);
    const formLabel = fgType.includes("ROLL")
        ? firstText(rollForm ? `Roll · ${titleCase(rollForm)}` : "", fgType)
        : firstText(pouchStyle ? `${titleCase(pouchStyle)} pouch` : "", fgType);

    const layerRecipe = Array.isArray(spec.layer_recipe) ? spec.layer_recipe : [];
    const layerSnapshot = Array.isArray(order.layer_snapshot) ? order.layer_snapshot : [];
    const layers = layerRecipe.length
        ? layerRecipe.map((row, index) => ({
            label: firstText(row.label, row.variant_code, row.variant_name, `L${index + 1}`),
            code: firstText(row.variant_code, row.material_code),
            name: firstText(row.variant_name, row.label),
            thickness: row.thickness_micron,
            grade: row.grade,
            width: row.width_mm,
        }))
        : layerSnapshot.map((row: any, index) => ({
            label: firstText(
                row.label,
                row.variant_code && row.variant_name ? `${row.variant_code} · ${row.variant_name}` : "",
                row.film_variant_code && row.film_variant_name ? `${row.film_variant_code} · ${row.film_variant_name}` : "",
                row.variant_code,
                row.film_variant_code,
                row.material_code,
                row.variant_name,
                row.film_variant_name,
                row.material_name,
                row.name,
                `L${index + 1}`,
            ),
            code: firstText(row.variant_code, row.film_variant_code, row.material_code, row.code),
            name: firstText(row.variant_name, row.film_variant_name, row.material_name, row.name),
            thickness: row.thickness_micron ?? row.thickness_um ?? row.thickness,
            grade: firstText(row.grade, row.grade_code, row.grade_name),
            width: row.roll_width_mm ?? row.input_roll_width_mm ?? row.width_mm,
        }));
    const thicknessExpression = firstText(
        spec.thickness_expression,
        layers.map((layer) => numberLabel(layer.thickness)).filter(Boolean).join("+"),
    );
    const totalThickness = spec.total_thickness_micron ?? layers.reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);
    const layerRecipeLabel = firstText(
        spec.layer_recipe_label,
        layers.map((layer) => [layer.code || layer.name || layer.label, numberLabel(layer.thickness) ? `${numberLabel(layer.thickness)}u` : ""].filter(Boolean).join(" ")).join(" + "),
    );
    const printType = firstText(order.print_type, fact.print_type, printing.print_type, printing.type, printing.method).toUpperCase();
    const front = Number(order.front_colors_count ?? fact.front_colors_count ?? printing.front_colors_count ?? 0);
    const back = Number(order.back_colors_count ?? fact.back_colors_count ?? printing.back_colors_count ?? 0);
    const printLabel = firstText(
        spec.print_label,
        fact.print_profile_label,
        order.display_printing_label,
        printType || front || back ? `${printType || "PRINT"} · F${front} / B${back}` : "",
    );
    const addons = Array.isArray(order.addons_snapshot)
        ? order.addons_snapshot.map((addon: any) => firstText(addon.name, addon.addon_name, addon.code, addon.addon_code)).filter(Boolean)
        : [];
    const packagingLabel = firstText(
        spec.packaging_label,
        order.display_packaging_label,
        packaging?.primary_inner_pack?.enabled ? "Inner pack" : "",
        packaging?.pod?.enabled ? "POD" : "",
        packaging?.roll_dispatch_pack?.enabled ? "Roll dispatch pack" : "",
    );
    const materialFamily = firstText(spec.material_family, layers.map((layer) => layer.code || layer.name || layer.label).filter(Boolean).join(" + "));

    return {
        fgType,
        productMaster,
        displayName,
        sizeLabel,
        formLabel,
        thicknessExpression,
        totalThickness: Number(totalThickness || 0),
        layerRecipeLabel,
        layers,
        printLabel,
        addons,
        packagingLabel,
        materialFamily,
    };
}

export function OrderPassportStrip({
    order,
    compact = false,
    showKpis = true,
}: {
    order: PlannerControlOrder;
    compact?: boolean;
    showKpis?: boolean;
}) {
    const p = getOrderPassport(order);
    const fgKind: ChipKind = p.fgType.includes("ROLL") ? "fg-roll" : p.fgType.includes("BAG") ? "fg-bag" : "fg-pouch";
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 7 : 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: compact ? 11 : 12, fontWeight: 800, color: "var(--text-1)" }}>
                    {order.order_number}
                    {order.sales_order_line_index ? ` · L${order.sales_order_line_index}` : ""}
                </span>
                <Chip kind={fgKind}>{p.fgType || "ORDER"}</Chip>
                {p.productMaster && <Chip kind="tpl">{p.productMaster}</Chip>}
                {p.sizeLabel && <Chip kind="size">{p.sizeLabel}</Chip>}
                {p.thicknessExpression && <Chip kind="thick">{p.thicknessExpression} um</Chip>}
                {p.printLabel && p.printLabel.toLowerCase() !== "no print" && <Chip kind="print">{p.printLabel}</Chip>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: showKpis ? "minmax(0, 1fr) minmax(220px, .55fr)" : "1fr", gap: 10, alignItems: "start" }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{
                        fontSize: compact ? 12 : 14,
                        lineHeight: 1.25,
                        fontWeight: 800,
                        color: "var(--text-1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: compact ? "nowrap" : "normal",
                    }}>
                        {p.displayName}
                    </div>
                    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                        {p.formLabel && <MiniSpec icon={<Package size={11} />} label={p.formLabel} />}
                        {p.materialFamily && <MiniSpec icon={<Layers size={11} />} label={p.materialFamily} />}
                        {p.layerRecipeLabel && <MiniSpec icon={<Scale size={11} />} label={p.layerRecipeLabel} strong />}
                        {p.addons.slice(0, 2).map((addon) => <MiniSpec key={addon} icon={<Boxes size={11} />} label={addon} />)}
                        {p.packagingLabel && p.packagingLabel !== "None" && <MiniSpec icon={<Package size={11} />} label={p.packagingLabel} />}
                    </div>
                </div>
                {showKpis && <OrderIntentKpis order={order} compact={compact} />}
            </div>
        </div>
    );
}

function MiniSpec({ icon, label, strong }: { icon: React.ReactNode; label: string; strong?: boolean }) {
    return (
        <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            maxWidth: "100%",
            padding: "3px 7px",
            borderRadius: "var(--r-pill)",
            border: "1px solid var(--border-soft)",
            background: strong ? "rgba(37,99,235,.08)" : "var(--surface-2)",
            color: strong ? "var(--br-700)" : "var(--text-2)",
            fontSize: 10,
            fontWeight: strong ? 800 : 700,
        }}>
            {icon}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        </span>
    );
}

export function OrderIntentKpis({ order, compact = false }: { order: PlannerControlOrder; compact?: boolean }) {
    const trace: Partial<PlannerProductionTrace> = order.production_trace ?? {};
    const produced = Number(trace.produced_qty ?? order.partial_produced_kg ?? order.qty_final_output ?? 0);
    const planned = Number(trace.planned_qty ?? order.required_qty_kg ?? 0);
    const remaining = Number(trace.remaining_qty ?? order.qty_replan_remaining_kg ?? order.partial_shortfall_kg ?? Math.max(0, planned - produced));
    const uom = trace.uom || order.qty_uom || "KG";
    const cells = [
        { label: "Required", value: fmt(order.required_qty_kg, 1), suffix: "KG", tone: "info" },
        { label: produced > 0 ? "Produced" : "Pieces", value: produced > 0 ? fmt(produced, 1) : order.required_qty_pcs != null ? fmt(order.required_qty_pcs, 0) : fmt(order.unit_weight_g, 2), suffix: produced > 0 ? uom : order.required_qty_pcs != null ? "PCS" : "g", tone: produced > 0 ? "success" : "default" },
        { label: remaining > 0 ? "Open" : "Progress", value: remaining > 0 ? fmt(remaining, 1) : fmt(order.production_trace?.progress_pct ?? 0, 0), suffix: remaining > 0 ? uom : "%", tone: remaining > 0 ? "warn" : "success" },
    ];
    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
            {cells.map((cell) => (
                <div key={cell.label} style={{
                    minWidth: 0,
                    padding: compact ? "6px 8px" : "8px 10px",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "var(--r-3)",
                    background: cell.tone === "success" ? "rgba(16,185,129,.07)" : cell.tone === "warn" ? "rgba(245,158,11,.08)" : cell.tone === "info" ? "rgba(37,99,235,.06)" : "var(--surface-1)",
                }}>
                    <div style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-4)" }}>{cell.label}</div>
                    <div style={{ marginTop: 3, display: "flex", alignItems: "baseline", gap: 3, minWidth: 0 }}>
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: compact ? 12 : 15, fontWeight: 900, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {cell.value}
                        </span>
                        <span style={{ fontSize: 8, fontWeight: 800, color: "var(--text-3)" }}>{cell.suffix}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function stateColors(stateRaw: unknown) {
    const state = clean(stateRaw).toUpperCase();
    if (["COMPLETED", "DONE", "READY"].includes(state)) return { bg: "rgba(16,185,129,.12)", stroke: "#10b981", text: "var(--e-700)" };
    if (["ACTIVE", "IN_PRODUCTION", "EXECUTING", "RUNNING", "WCM_HANDOFF_READY"].includes(state)) return { bg: "rgba(37,99,235,.14)", stroke: "#2563eb", text: "var(--br-700)" };
    if (["REPLAN_REQUIRED", "WAITING", "PAUSED"].includes(state)) return { bg: "rgba(245,158,11,.14)", stroke: "#f59e0b", text: "var(--a-700)" };
    if (["BLOCKED", "LATE"].includes(state)) return { bg: "rgba(244,63,94,.14)", stroke: "#f43f5e", text: "var(--r-700)" };
    if (state === "SKIPPED") return { bg: "var(--surface-2)", stroke: "#cbd5e1", text: "var(--text-4)" };
    return { bg: "var(--surface-2)", stroke: "#94a3b8", text: "var(--text-3)" };
}

export function RouteGraphSvg({
    trace,
    steps,
    height = 220,
}: {
    trace?: PlannerProductionTrace;
    steps?: any[];
    height?: number;
}) {
    const topology: PlannerRouteTopologyLane[] = Array.isArray(trace?.route_topology) && trace!.route_topology!.length
        ? trace!.route_topology!
        : [{
            key: "route",
            label: "Production route",
            role: "route",
            nodes: (steps || trace?.route_steps || []).map((step: any) => ({
                ...step,
                label: step.process_name || step.step_name || step.process_code,
                state: step.state || "WAITING",
            })),
        }];
    const lanes = topology.filter((lane) => Array.isArray(lane.nodes) && lane.nodes.length > 0).slice(0, 4);
    const laneHeight = 52;
    const svgHeight = Math.max(height, 34 + lanes.length * laneHeight);
    const viewWidth = 960;
    return (
        <div style={{ width: "100%", overflowX: "auto", paddingBottom: 2 }}>
            <svg role="img" aria-label="Production route graph" viewBox={`0 0 ${viewWidth} ${svgHeight}`} style={{ width: "100%", minWidth: 620, height: svgHeight, display: "block" }}>
                <defs>
                    <filter id="ct-route-shadow" x="-10%" y="-20%" width="120%" height="160%">
                        <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0f172a" floodOpacity=".10" />
                    </filter>
                </defs>
                {lanes.map((lane, laneIndex) => {
                    const y = 34 + laneIndex * laneHeight;
                    const nodes = lane.nodes || [];
                    const nodeCount = Math.max(nodes.length, 1);
                    const left = 170;
                    const right = viewWidth - 34;
                    const gap = nodeCount === 1 ? 0 : (right - left) / (nodeCount - 1);
                    return (
                        <g key={lane.key || laneIndex}>
                            <text x="18" y={y + 4} fill="var(--text-3)" fontSize="11" fontWeight="800" letterSpacing=".8">
                                {lane.label.toUpperCase()}
                            </text>
                            {nodes.length > 1 && (
                                <line
                                    x1={left}
                                    x2={right}
                                    y1={y}
                                    y2={y}
                                    stroke={lane.parallel ? "#6366f1" : "#cbd5e1"}
                                    strokeWidth="2"
                                    strokeDasharray={lane.parallel ? "7 7" : "0"}
                                />
                            )}
                            {nodes.map((node, index) => {
                                const x = left + gap * index;
                                const colors = stateColors(node.state);
                                const label = firstText(node.label, node.process_name, node.process_code, `Step ${node.sequence_number ?? index + 1}`);
                                return (
                                    <g key={`${lane.key}-${index}`} transform={`translate(${x}, ${y})`}>
                                        <circle r="15" fill={colors.bg} stroke={colors.stroke} strokeWidth="2.5" filter="url(#ct-route-shadow)" />
                                        <text x="0" y="4" textAnchor="middle" fill={colors.text} fontSize="10" fontWeight="900">
                                            {node.sequence_number != null ? node.sequence_number : index + 1}
                                        </text>
                                        <foreignObject x="-54" y="20" width="108" height="30">
                                            <div style={{ fontSize: 9, fontWeight: 800, lineHeight: 1.1, textAlign: "center", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {label}
                                            </div>
                                        </foreignObject>
                                    </g>
                                );
                            })}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

type TraceMode = "live" | "completed";

function asArray<T = any>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function routeIndex(step: Partial<PlannerProductionRouteStep>, fallback: number): number {
    const direct = Number(step.route_index);
    if (Number.isFinite(direct)) return direct;
    const sequence = Number(step.sequence_number);
    if (Number.isFinite(sequence)) return Math.max(0, sequence - 1);
    return fallback;
}

function normalizeRouteSteps(order: PlannerControlOrder, trace: Partial<PlannerProductionTrace>): PlannerProductionRouteStep[] {
    const traceSteps = asArray<PlannerProductionRouteStep>(trace.route_steps);
    const templateSteps = asArray<any>(order.template_steps);
    const source = traceSteps.length ? traceSteps : templateSteps;
    return source.map((step: any, index) => ({
        ...step,
        route_index: routeIndex(step, index),
        sequence_number: Number.isFinite(Number(step.sequence_number)) ? Number(step.sequence_number) : index + 1,
        process_code: clean(step.process_code),
        process_name: firstText(step.process_name, step.step_name, step.process_code, `Step ${index + 1}`),
        step_name: firstText(step.step_name, step.process_name, step.process_code, `Step ${index + 1}`),
        input_form: clean(step.input_form),
        output_form: clean(step.output_form),
        state: clean(step.state) || "WAITING",
    }));
}

function mergeJobs(order: PlannerControlOrder, trace: Partial<PlannerProductionTrace>, liveJobs: any[]): any[] {
    const completed = asArray<any>(trace.jobs).length ? asArray<any>(trace.jobs) : asArray<any>((order as any).completed_jobs);
    const map = new Map<string, any>();
    [...liveJobs, ...completed].forEach((job, index) => {
        const key = clean(job?.id) || clean(job?.job_id) || clean(job?.job_number) || `job-${index}`;
        map.set(key, { ...map.get(key), ...job });
    });
    return Array.from(map.values()).sort((a, b) => {
        const ai = jobRouteIndex(a);
        const bi = jobRouteIndex(b);
        if (ai !== bi) return ai - bi;
        return clean(a.job_number).localeCompare(clean(b.job_number));
    });
}

function jobRouteIndex(job: any): number {
    const direct = Number(job.current_step_index ?? job.step_index ?? job.route_index);
    if (Number.isFinite(direct)) return direct;
    const match = clean(job.job_number).match(/-(\d+)(?:-[^-]+)?$/);
    if (match) return Math.max(0, Number(match[1]) || 0);
    return 999;
}

function jobProcessCode(job: any): string {
    return clean(job.process_code || job.current_process_code || job.step_process_code);
}

function jobMatchesStep(job: any, step: PlannerProductionRouteStep): boolean {
    const byIndex = jobRouteIndex(job) === routeIndex(step, 0);
    const stepCode = clean(step.process_code).toUpperCase();
    const byCode = !!stepCode && jobProcessCode(job).toUpperCase() === stepCode;
    const stepName = clean(step.process_name || step.step_name).toLowerCase();
    const jobLabel = clean(job.step_label || job.process_name || job.process_code).toLowerCase();
    return byIndex || (!!stepName && !!jobLabel && jobLabel.includes(stepName));
}

function qtyValue(job: any, ...keys: string[]): number {
    for (const key of keys) {
        const value = Number(job?.[key]);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
}

function laneCount(step: PlannerProductionRouteStep): number {
    const handling: any = step.roll_handling || {};
    const schema = Array.isArray(handling.lane_schema) ? handling.lane_schema.length : 0;
    return Math.max(
        Number(handling.input_lane_count || 0),
        Number(handling.input_roll_count || 0),
        schema,
        0,
    );
}

export function ProductionTracePanel({
    order,
    dense = false,
    liveJobs = [],
    mode = "live",
}: {
    order: PlannerControlOrder;
    dense?: boolean;
    liveJobs?: any[];
    mode?: TraceMode;
}) {
    const trace: Partial<PlannerProductionTrace> = order.production_trace ?? {};
    const steps = normalizeRouteSteps(order, trace);
    const jobs = mergeJobs(order, trace, liveJobs);
    const materialPlan: any[] = asArray(order.material_plan_lines);
    const progress = Number(trace.progress_pct || 0);
    const source = clean(trace.template_route_source) === "template_process_steps" ? "Template route" : steps.length ? "Routing rule fallback" : "Route pending";
    const jobLabel = mode === "completed" ? "Completed job ledger" : "Live job ledger";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: dense ? 10 : 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <TraceMetric icon={<Activity size={13} />} label="State" value={trace.job_state || order.status || "Waiting"} />
                <TraceMetric icon={<Workflow size={13} />} label="WCM handoff" value={trace.wcm_handoff_state || "-"} />
                <TraceMetric icon={<Route size={13} />} label="Route source" value={source} />
                <TraceMetric icon={<Scale size={13} />} label="Produced" value={`${fmt(trace.produced_qty ?? order.qty_final_output ?? 0, 1)} / ${fmt(trace.planned_qty ?? order.required_qty_kg ?? 0, 1)} ${trace.uom || order.qty_uom || "KG"}`} />
                <TraceMetric icon={<Clock size={13} />} label="Progress" value={`${fmt(progress, 0)}%`} />
            </div>

            <RouteDecisionStrip trace={trace} order={order} />

            <TraceSection
                eyebrow="Production traveller"
                title={steps.length ? `${steps.length} real route step${steps.length === 1 ? "" : "s"}` : "Route is not resolved"}
                caption="Template routing drives this lane. Source and release gates are shown separately so they do not look like production steps."
            >
                <ProductionRouteLedger steps={steps} jobs={jobs} materialPlan={materialPlan} dense={dense} />
            </TraceSection>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
                <TraceSection
                    eyebrow={jobLabel}
                    title={jobs.length ? `${jobs.length} job row${jobs.length === 1 ? "" : "s"}` : "No WCM movement yet"}
                    caption={mode === "completed" ? "Closed and posted jobs, ordered by route step." : "Released, waiting, running, paused, and posted jobs from WCM."}
                >
                    <JobLedgerCards jobs={jobs} dense={dense} emptyMode={mode} />
                </TraceSection>
                <TraceSection
                    eyebrow="Material issue plan"
                    title={materialPlan.length ? `${materialPlan.length} issue row${materialPlan.length === 1 ? "" : "s"}` : "No material issue rows"}
                    caption="Material lines stay attached to their category or route step where available."
                >
                    <MaterialIssueCards lines={materialPlan} dense={dense} />
                </TraceSection>
            </div>
        </div>
    );
}

function TraceSection({ eyebrow, title, caption, children }: { eyebrow: string; title: string; caption?: string; children: React.ReactNode }) {
    return (
        <section style={{ minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                    <div className="t-eyebrow">{eyebrow}</div>
                    <div style={{ marginTop: 2, fontSize: 13, fontWeight: 900, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                </div>
                {caption && <div style={{ maxWidth: 360, fontSize: 10, lineHeight: 1.35, color: "var(--text-4)", textAlign: "right" }}>{caption}</div>}
            </div>
            {children}
        </section>
    );
}

function RouteDecisionStrip({ trace, order }: { trace: Partial<PlannerProductionTrace>; order: PlannerControlOrder }) {
    const lanes = asArray<PlannerRouteTopologyLane>(trace.route_topology);
    const sourceLane = lanes.find((lane) => lane.role === "source" || lane.key === "source");
    const releaseLane = lanes.find((lane) => lane.role === "gate" || lane.key === "release");
    const combineLane = lanes.find((lane) => lane.role === "parallel" || lane.key === "combine");
    const sourceLabel = firstText(sourceLane?.nodes?.[0]?.label, (order as any).source_summary?.recommended_label, "Fresh production");
    const sourceDetail = firstText(sourceLane?.nodes?.[0]?.detail, (order as any).source_summary?.recommended_reason, "No reusable stock path selected");
    const releaseNodes = asArray<any>(releaseLane?.nodes);
    const blocked = releaseNodes.filter((node) => ["BLOCKED", "WAITING"].includes(clean(node.state).toUpperCase())).length;
    const combineNodes = asArray<any>(combineLane?.nodes);
    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 8 }}>
            <DecisionCard label="Source decision" value={sourceLabel} detail={sourceDetail} tone={clean(sourceLane?.nodes?.[0]?.state)} />
            <DecisionCard label="Release gates" value={blocked ? `${blocked} gate${blocked === 1 ? "" : "s"} waiting` : "Release clear"} detail={releaseNodes.map((node) => `${node.label}: ${node.state}`).join(" · ") || "No release checklist rows"} tone={blocked ? "WAITING" : "READY"} />
            <DecisionCard label="Combine / reuse" value={combineNodes.length ? `${combineNodes.length} available path${combineNodes.length === 1 ? "" : "s"}` : "No combine path"} detail={combineNodes.map((node) => `${node.label} ${node.detail || ""}`.trim()).join(" · ") || "Fresh route will run end to end"} tone={combineNodes.length ? "READY" : "WAITING"} />
        </div>
    );
}

function DecisionCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
    const colors = stateColors(tone || "WAITING");
    return (
        <div style={{ padding: "9px 11px", border: `1px solid ${colors.stroke}33`, borderRadius: "var(--r-3)", background: colors.bg }}>
            <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-4)" }}>{label}</div>
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
            <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</div>
        </div>
    );
}

function ProductionRouteLedger({ steps, jobs, materialPlan, dense }: { steps: PlannerProductionRouteStep[]; jobs: any[]; materialPlan: any[]; dense?: boolean }) {
    if (!steps.length) {
        return (
            <div style={{ padding: 12, border: "1px dashed var(--border-soft)", borderRadius: "var(--r-3)", color: "var(--text-4)", fontSize: 11 }}>
                No routing template is attached to this order line yet.
            </div>
        );
    }
    const groups = Array.from(steps.reduce((map, step) => {
        const key = routeIndex(step, map.size);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(step);
        return map;
    }, new Map<number, PlannerProductionRouteStep[]>()).entries()).sort(([a], [b]) => a - b);
    const minWidth = Math.max(dense ? 560 : 640, groups.length * (dense ? 196 : 228));
    return (
        <div style={{ width: "100%", overflowX: "auto", paddingBottom: 4, overscrollBehaviorX: "contain", WebkitOverflowScrolling: "touch", scrollbarGutter: "stable", scrollSnapType: dense ? "x proximity" : "none", contain: "layout paint" }}>
            <div style={{ minWidth, display: "grid", gridTemplateColumns: `repeat(${groups.length}, minmax(${dense ? 188 : 216}px, 1fr))`, gap: 8, alignItems: "stretch" }}>
                {groups.map(([index, group], groupIndex) => {
                    const relatedJobs = jobs.filter((job) => group.some((step) => jobMatchesStep(job, step)));
                    const relatedMaterials = materialPlan.filter((line) => group.some((step) => materialMatchesStep(line, step)));
                    return (
                        <div key={index} style={{ position: "relative" }}>
                            {groupIndex < groups.length - 1 && (
                                <div aria-hidden="true" style={{ position: "absolute", top: 26, left: "calc(100% - 4px)", width: 16, height: 2, background: "var(--border)", zIndex: 0 }} />
                            )}
                            <RouteStepGroupCard index={index} steps={group} jobs={relatedJobs} materials={relatedMaterials} dense={dense} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function materialMatchesStep(line: any, step: PlannerProductionRouteStep): boolean {
    const haystack = `${line.step_name || ""} ${line.policy_key || ""} ${line.category_code || ""}`.toLowerCase();
    const stepName = clean(step.process_name || step.step_name).toLowerCase();
    const code = clean(step.process_code).toLowerCase();
    return (!!stepName && haystack.includes(stepName)) || (!!code && haystack.includes(code));
}

function RouteStepGroupCard({ index, steps, jobs, materials, dense }: { index: number; steps: PlannerProductionRouteStep[]; jobs: any[]; materials: any[]; dense?: boolean }) {
    const primary = steps[0];
    const colors = stateColors(primary?.state || "WAITING");
    const target = jobs.reduce((sum, job) => sum + qtyValue(job, "planned_qty", "quantity", "total_weight_kg"), 0);
    const produced = jobs.reduce((sum, job) => sum + qtyValue(job, "produced_qty"), 0);
    const pct = target > 0 ? Math.min(100, (produced / target) * 100) : 0;
    const maxLaneCount = steps.reduce((max, step) => Math.max(max, laneCount(step)), 0);
    const parallel = steps.length > 1 || maxLaneCount > 1;
    return (
        <div style={{ position: "relative", zIndex: 1, minHeight: dense ? 158 : 208, padding: dense ? 9 : 12, border: `1px solid ${colors.stroke}55`, borderRadius: "var(--r-4)", background: "var(--surface-1)", boxShadow: "var(--sh-xs)", display: "flex", flexDirection: "column", gap: 7, scrollSnapAlign: "start" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 24, height: 24, borderRadius: 999, display: "inline-grid", placeItems: "center", background: colors.bg, border: `2px solid ${colors.stroke}`, color: colors.text, fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 900 }}>
                            {index + 1}
                        </span>
                        <StepStatePill state={primary?.state || "WAITING"} />
                    </div>
                    <div style={{ marginTop: 7, fontSize: 13, fontWeight: 950, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {steps.length > 1 ? `Parallel set (${steps.length})` : primary.process_name || primary.step_name || primary.process_code}
                    </div>
                    <div style={{ marginTop: 2, fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--text-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {steps.map((step) => firstText(step.input_form, "INPUT") + " -> " + firstText(step.output_form, "OUTPUT")).join(" / ")}
                    </div>
                </div>
                {parallel && <span style={{ padding: "3px 7px", borderRadius: "var(--r-pill)", background: "rgba(99,102,241,.10)", color: "var(--i-700)", fontSize: 9, fontWeight: 900 }}>{maxLaneCount || steps.length} lanes</span>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {steps.map((step) => (
                    <div key={step.step_id || step.id || `${step.sequence_number}-${step.process_code}`} style={{ padding: "6px 8px", border: "1px solid var(--border-soft)", borderRadius: "var(--r-2)", background: "var(--surface-2)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 900, color: "var(--text-1)" }}>{step.process_name || step.step_name || step.process_code}</span>
                            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--text-4)", whiteSpace: "nowrap" }}>{step.process_code || `S${step.sequence_number}`}</span>
                        </div>
                        <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {step.default_work_center_name && <MiniRouteTag>{step.default_work_center_name}</MiniRouteTag>}
                            {step.work_center_selection_policy && <MiniRouteTag>{titleCase(step.work_center_selection_policy)}</MiniRouteTag>}
                            {step.roll_behavior && <MiniRouteTag>{titleCase(step.roll_behavior)}</MiniRouteTag>}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: "auto", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 }}>
                <SmallLog label="Jobs" value={String(jobs.length)} />
                <SmallLog label="Material" value={materials.length ? `${materials.length} rows` : "-"} />
                <SmallLog label="WIP" value={target > 0 ? `${fmt(produced, 1)} / ${fmt(target, 1)}` : "-"} />
            </div>
            <div style={{ height: 5, borderRadius: 999, overflow: "hidden", background: "var(--surface-2)" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: colors.stroke, transition: "width var(--ds) var(--eo)" }} />
            </div>
        </div>
    );
}

function StepStatePill({ state }: { state: string }) {
    const colors = stateColors(state);
    return (
        <span style={{ padding: "3px 7px", borderRadius: "var(--r-pill)", background: colors.bg, color: colors.text, border: `1px solid ${colors.stroke}55`, fontSize: 9, fontWeight: 900, textTransform: "uppercase" }}>
            {clean(state).replace(/_/g, " ") || "Waiting"}
        </span>
    );
}

function MiniRouteTag({ children }: { children: React.ReactNode }) {
    return (
        <span style={{ minWidth: 0, maxWidth: "100%", padding: "2px 6px", borderRadius: "var(--r-pill)", border: "1px solid var(--border-soft)", background: "var(--surface-1)", color: "var(--text-3)", fontSize: 8, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {children}
        </span>
    );
}

function JobLedgerCards({ jobs, dense, emptyMode }: { jobs: any[]; dense?: boolean; emptyMode: TraceMode }) {
    if (!jobs.length) {
        return (
            <div style={{ padding: 12, border: "1px dashed var(--border-soft)", borderRadius: "var(--r-3)", color: "var(--text-4)", fontSize: 11 }}>
                {emptyMode === "completed"
                    ? "No completed job log is attached to this closed line yet."
                    : "No active WCM job row is attached yet. Release and route handoff state still comes from the control hub."}
            </div>
        );
    }
    const limit = dense ? 4 : 16;
    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 7, maxHeight: dense ? undefined : 420, overflowY: dense ? "visible" : "auto", paddingRight: dense ? 0 : 2, overscrollBehavior: "contain", scrollbarGutter: dense ? undefined : "stable", contain: "layout paint" }}>
            {jobs.slice(0, limit).map((job, index) => <JobTraceRow key={job.id || job.job_number || index} job={job} />)}
            {jobs.length > limit && (
                <div style={{ padding: "9px 10px", border: "1px dashed var(--border-soft)", borderRadius: "var(--r-3)", background: "var(--surface-2)", color: "var(--text-3)", fontSize: 10, fontWeight: 800 }}>
                    +{jobs.length - limit} more WCM job row{jobs.length - limit === 1 ? "" : "s"} in this order
                </div>
            )}
        </div>
    );
}

function MaterialIssueCards({ lines, dense }: { lines: any[]; dense?: boolean }) {
    if (!lines.length) {
        return (
            <div style={{ padding: 12, border: "1px dashed var(--border-soft)", borderRadius: "var(--r-3)", color: "var(--text-4)", fontSize: 11 }}>
                Material issue rows are not attached to this trace.
            </div>
        );
    }
    const limit = dense ? 5 : 18;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: dense ? undefined : 420, overflowY: dense ? "visible" : "auto", paddingRight: dense ? 0 : 2, overscrollBehavior: "contain", scrollbarGutter: dense ? undefined : "stable", contain: "layout paint" }}>
            {lines.slice(0, limit).map((line: any, index) => (
                <div key={index} style={{ padding: "8px 10px", border: "1px solid var(--border-soft)", borderRadius: "var(--r-2)", background: "var(--surface-1)", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.material_name || line.material_code || "Material"}</div>
                        <div style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--text-4)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.step_name || line.category_code || line.policy_key || "-"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 900, color: "var(--text-1)", whiteSpace: "nowrap" }}>
                            {fmt(line.planned_issue_qty ?? line.theoretical_qty, 3)} {line.uom || ""}
                        </div>
                        {line.capture_mode && <div style={{ marginTop: 1, fontSize: 8, fontWeight: 800, color: "var(--text-4)", textTransform: "uppercase" }}>{line.capture_mode}</div>}
                    </div>
                </div>
            ))}
            {lines.length > limit && (
                <div style={{ padding: "8px 10px", border: "1px dashed var(--border-soft)", borderRadius: "var(--r-2)", background: "var(--surface-2)", color: "var(--text-3)", fontSize: 10, fontWeight: 800 }}>
                    +{lines.length - limit} more material issue row{lines.length - limit === 1 ? "" : "s"} attached
                </div>
            )}
        </div>
    );
}

function TraceMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div style={{ padding: "9px 11px", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", background: "var(--surface-1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-4)" }}>
                {icon}
                {label}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
        </div>
    );
}

function JobTraceRow({ job }: { job: any }) {
    const closedAt = job.closed_at ? formatDisplayDateTime(job.closed_at) : "";
    const updatedAt = !closedAt && job.updated_at ? formatDisplayDateTime(job.updated_at) : "";
    const target = qtyValue(job, "planned_qty", "quantity", "total_weight_kg");
    const produced = qtyValue(job, "produced_qty");
    const pct = target > 0 ? Math.min(100, (produced / target) * 100) : 0;
    const colors = stateColors(job.job_state || job.status || (closedAt ? "COMPLETED" : "WAITING"));
    return (
        <div style={{ padding: "9px 10px", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", background: "var(--surface-1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 900, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {job.job_number || job.id || "Job"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                        {[job.step_label || job.process_name || job.process_code, job.work_center_name, job.machine_name].filter(Boolean).join(" · ") || "-"}
                    </div>
                </div>
                <StepStatePill state={job.job_state || job.status || (closedAt ? "COMPLETED" : "WAITING")} />
            </div>
            <div style={{ marginTop: 7, height: 5, borderRadius: 999, overflow: "hidden", background: "var(--surface-2)" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: colors.stroke }} />
            </div>
            <div style={{ marginTop: 7, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 5 }}>
                <SmallLog label="WIP flow" value={`${firstText(job.input_form, "IN")} -> ${firstText(job.output_form, "OUT")}`} />
                <SmallLog label="Posted" value={`${fmt(produced, 1)} / ${fmt(target, 1)} ${job.uom || "KG"}`} />
                <SmallLog label="Scrap" value={`${fmt(job.scrap_qty, 1)} ${job.uom || "KG"}`} />
                <SmallLog label="Operator" value={job.operator_name || job.closed_by_name || "-"} />
                <SmallLog label={closedAt ? "Closed" : "Updated"} value={closedAt || updatedAt || "-"} />
            </div>
        </div>
    );
}

function SmallLog({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-4)" }}>{label}</div>
            <div style={{ marginTop: 1, fontSize: 10, fontWeight: 800, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
        </div>
    );
}

export function PassportDetailGrid({ order }: { order: PlannerControlOrder }) {
    const p = getOrderPassport(order);
    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <TraceMetric icon={<Ruler size={13} />} label="Size / geometry" value={p.sizeLabel || "-"} />
            <TraceMetric icon={<Scale size={13} />} label="Thickness" value={p.thicknessExpression ? `${p.thicknessExpression} um (${fmt(p.totalThickness, 0)} total)` : "-"} />
            <TraceMetric icon={<Layers size={13} />} label="Layer recipe" value={p.layerRecipeLabel || "-"} />
            <TraceMetric icon={<Printer size={13} />} label="Printing" value={p.printLabel || "No print"} />
            <TraceMetric icon={<Package size={13} />} label="Packaging" value={p.packagingLabel || "-"} />
            <TraceMetric icon={<Route size={13} />} label="Route span" value={order.production_trace?.route_span_label || order.display_route_summary || `Step ${order.required_start_step ?? "-"} to ${order.route_last_step_index ?? "-"}`} />
        </div>
    );
}
