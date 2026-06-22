"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, MapPin, Package, Rocket, X } from "lucide-react";

import {
    plannerService,
    type PlannerControlOrder,
    type PlannerOrderKind,
    type PlannerInventoryOption,
    type PlannerSourceOption,
    type PlannerAllocationPayload,
    type PlannerRouteDispatchWorkCenter,
} from "@/services/planner";
import { useToast } from "@/hooks/use-toast";
import { Button, Chip } from "@/components/_planner-ui";

interface InventorySelectDialogProps {
    order: PlannerControlOrder | null;
    onClose: () => void;
    onCommitted?: () => void;
}

type Mode = Extract<PlannerSourceOption, "FG" | "WIP_CONTINUE" | "SHARED_INVARIANT" | "UPSTREAM_STOCK" | "FRESH">;

function fmt(n: any, decimals = 1) {
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

function isCarryForwardWipOption(option: PlannerInventoryOption) {
    return sourceBucket(option) === "CARRY_FORWARD_WIP";
}

function isSharedInvariantOption(option: PlannerInventoryOption) {
    return sourceBucket(option) === "SHARED_INVARIANT_ROLL_STOCK";
}

function isUpstreamInputOption(option: PlannerInventoryOption) {
    return sourceBucket(option) === "COMPATIBLE_UPSTREAM_ROLL_STOCK";
}

type TemplateRouteStep = NonNullable<PlannerControlOrder["template_steps"]>[number];

function stepIndex(step: TemplateRouteStep) {
    return Number(step.sequence_number ?? 0);
}

function routeLastIndex(order: PlannerControlOrder | null) {
    const fromOrder = Number(order?.route_last_step_index);
    if (Number.isFinite(fromOrder)) return fromOrder;
    const steps = order?.template_steps || [];
    return Math.max(0, ...steps.map((step) => stepIndex(step)));
}

function selectedInventoryOptions(order: PlannerControlOrder | null, allocations: Record<string, string>) {
    if (!order) return [];
    const options = order.inventory_options || [];
    return Object.entries(allocations)
        .filter(([, value]) => {
            const qty = Number(value);
            return Number.isFinite(qty) && qty > 0;
        })
        .map(([key]) => options.find((o) => `${o.inventory_type}:${o.inventory_id}` === key))
        .filter((option): option is PlannerInventoryOption => Boolean(option));
}

function routeRangeForMode(order: PlannerControlOrder | null, mode: Mode, allocations: Record<string, string>) {
    const last = routeLastIndex(order);
    if (!order) return { start: 0, stop: last };
    if (mode === "FG") return { start: last, stop: last };
    if (mode === "WIP_CONTINUE" || mode === "SHARED_INVARIANT") {
        const selected = selectedInventoryOptions(order, allocations);
        if (selected.length > 0) {
            const completed = Math.max(...selected.map((option) => Number(option.completed_step_index || 0)));
            return { start: Math.min(last, completed + 1), stop: last };
        }
    }
    if (mode === "UPSTREAM_STOCK") {
        const required = Number(order.required_start_step);
        return { start: Number.isFinite(required) ? required : 0, stop: last };
    }
    const required = Number(order.required_start_step);
    return { start: Number.isFinite(required) ? required : 0, stop: last };
}

function activeTemplateSteps(order: PlannerControlOrder | null, mode: Mode, allocations: Record<string, string>) {
    if (!order) return [];
    const { start, stop } = routeRangeForMode(order, mode, allocations);
    return (order.template_steps || []).filter((step) => {
        const idx = stepIndex(step);
        return idx >= start && idx <= stop;
    });
}

function routeDispatchCandidates(step: TemplateRouteStep): PlannerRouteDispatchWorkCenter[] {
    const status = step.dispatch_status;
    if (!status) return [];
    return status.valid_candidates?.length ? status.valid_candidates : status.candidates || [];
}

function routeDispatchPolicy(step: TemplateRouteStep) {
    return String(step.dispatch_status?.selection_policy || "").toUpperCase();
}

function stepNeedsRouteDispatchChoice(step: TemplateRouteStep) {
    const status = String(step.dispatch_status?.status || "").toUpperCase();
    const policy = routeDispatchPolicy(step);
    return routeDispatchCandidates(step).length > 0 && (policy === "PLANNER_REQUIRED" || status === "NEEDS_DECISION");
}

function suggestedWorkCenterId(step: TemplateRouteStep) {
    const status = step.dispatch_status;
    if (!status || routeDispatchPolicy(step) === "PLANNER_REQUIRED") return "";
    if (status.default_work_center_valid && status.default_work_center?.id) {
        return status.default_work_center.id;
    }
    const candidates = routeDispatchCandidates(step);
    return candidates.length === 1 ? candidates[0].id : "";
}

function routeDispatchStepLabel(step: TemplateRouteStep) {
    const display = Number(step.display_sequence ?? stepIndex(step) + 1);
    const label = step.process_name || step.step_name || step.process_code || "Route step";
    return `Step ${Number.isFinite(display) ? display : stepIndex(step) + 1} · ${label}`;
}

function optionPickLocation(option: PlannerInventoryOption) {
    return [option.location_name, option.location_code, option.plant_name].filter(Boolean).join(" · ");
}

export function InventorySelectDialog({ order, onClose, onCommitted }: InventorySelectDialogProps) {
    const { toast } = useToast();
    const [mode, setMode] = useState<Mode>("FRESH");
    const [allocations, setAllocations] = useState<Record<string, string>>({});
    const [workCenterOverrides, setWorkCenterOverrides] = useState<Record<number, string>>({});
    const [release, setRelease] = useState(true);

    // Reset state when order changes
    useEffect(() => {
        if (!order) return;
        const fgAvail = !!order.source_availability?.has_fg;
        const source = order.source_availability;
        const recommended = String(order.source_summary?.recommended_option || "").toUpperCase();
        const options = order.inventory_options || [];
        const hasCarryWip = !!source?.has_wip || options.some(isCarryForwardWipOption);
        const hasShared = !!source?.has_shared_invariant_roll_stock || options.some(isSharedInvariantOption);
        const hasUpstream = !!source?.has_compatible_upstream_roll || options.some(isUpstreamInputOption);
        setMode(
            fgAvail
                ? "FG"
                : recommended === "SHARED_INVARIANT" && hasShared
                  ? "SHARED_INVARIANT"
                  : recommended === "UPSTREAM_STOCK" && hasUpstream
                    ? "UPSTREAM_STOCK"
                    : hasCarryWip
                      ? "WIP_CONTINUE"
                      : hasShared
                        ? "SHARED_INVARIANT"
                        : hasUpstream
                          ? "UPSTREAM_STOCK"
                          : "FRESH"
        );
        setAllocations({});
        setWorkCenterOverrides({});
        setRelease(true);
    }, [order?.order_id, order?.sales_order_item_id]);

    const fgOptions = useMemo<PlannerInventoryOption[]>(() => {
        if (!order) return [];
        return (order.inventory_options || []).filter(isExactFgOption);
    }, [order]);
    const wipOptions = useMemo<PlannerInventoryOption[]>(() => {
        if (!order) return [];
        return (order.inventory_options || []).filter(isCarryForwardWipOption);
    }, [order]);
    const sharedInvariantOptions = useMemo<PlannerInventoryOption[]>(() => {
        if (!order) return [];
        return (order.inventory_options || []).filter(isSharedInvariantOption);
    }, [order]);
    const upstreamInputOptions = useMemo<PlannerInventoryOption[]>(() => {
        if (!order) return [];
        return (order.inventory_options || []).filter(isUpstreamInputOption);
    }, [order]);

    const visibleOptions =
        mode === "FG"
            ? fgOptions
            : mode === "WIP_CONTINUE"
              ? wipOptions
              : mode === "SHARED_INVARIANT"
                ? sharedInvariantOptions
                : mode === "UPSTREAM_STOCK"
                  ? upstreamInputOptions
                  : [];
    const requiredKg = Number(order?.required_qty_kg || 0);

    const totalAllocated = useMemo(() => {
        return Object.values(allocations).reduce((sum, v) => {
            const n = Number(v);
            return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
    }, [allocations]);
    const selectedIsWipContinuation = mode === "WIP_CONTINUE" || mode === "SHARED_INVARIANT";
    const routeRange = useMemo(() => routeRangeForMode(order, mode, allocations), [order, mode, allocations]);
    const executionKg = selectedIsWipContinuation && totalAllocated > 0 ? Math.min(requiredKg, totalAllocated) : totalAllocated;
    const remainingAfterSelectedRun = Math.max(0, requiredKg - executionKg);
    const expectedReturnKg = selectedIsWipContinuation ? Math.max(0, totalAllocated - requiredKg) : 0;

    const routeDispatchSteps = useMemo(() => {
        return activeTemplateSteps(order, mode, allocations).filter(stepNeedsRouteDispatchChoice);
    }, [order, mode, allocations]);
    const requiresAlloc = mode !== "FRESH";

    const routeDispatchChoiceFor = (step: TemplateRouteStep) => {
        const idx = stepIndex(step);
        return workCenterOverrides[idx] || suggestedWorkCenterId(step);
    };

    const missingRouteDispatchSteps = routeDispatchSteps.filter((step) => !routeDispatchChoiceFor(step));

    const planMutation = useMutation({
        mutationFn: async () => {
            if (!order) throw new Error("No order");
            const allocList: PlannerAllocationPayload[] = requiresAlloc
                ? Object.entries(allocations)
                      .map<PlannerAllocationPayload | null>(([key, value]) => {
                          const qty = Number(value);
                          if (!Number.isFinite(qty) || qty <= 0) return null;
                          const opt = (order.inventory_options || []).find(
                              (o) => `${o.inventory_type}:${o.inventory_id}` === key
                          );
                          if (!opt) return null;
                          return {
                              inventory_type: opt.inventory_type,
                              inventory_id: opt.inventory_id,
                              allocated_qty_kg: qty,
                              source_bucket: opt.source_bucket,
                              signature_match_mode: opt.signature_match_mode,
                          };
                      })
                      .filter((x): x is PlannerAllocationPayload => x !== null)
                : [];
            const workCenterOverrideList = routeDispatchSteps
                .map((step) => {
                    const workCenterId = routeDispatchChoiceFor(step);
                    if (!workCenterId) return null;
                    return {
                        step_index: stepIndex(step),
                        work_center_id: workCenterId,
                    };
                })
                .filter((row): row is { step_index: number; work_center_id: string } => Boolean(row));
            let planRemainingFreshNow = false;
            if (selectedIsWipContinuation && totalAllocated > 0 && remainingAfterSelectedRun > 0) {
                planRemainingFreshNow = window.confirm(
                    `${fmt(remainingAfterSelectedRun)} KG will remain after the selected WIP run.\n\nOK: place a fresh balance run now.\nCancel: skip for now; remaining quantity will return to planner after this run completes.`
                );
            }

            const planRes = await plannerService.planOrder(
                order.order_kind as PlannerOrderKind,
                order.order_id,
                {
                    option: mode,
                    allocations: allocList,
                    item_id: order.sales_order_item_id || undefined,
                    start_step_index: routeRange.start,
                    stop_step_index: routeRange.stop,
                    work_center_overrides: workCenterOverrideList,
                    plan_remaining_fresh_now: planRemainingFreshNow,
                }
            );
            if (release) {
                await plannerService.releasePlannedOrder(
                    order.order_kind as PlannerOrderKind,
                    order.order_id,
                    { item_id: order.sales_order_item_id || undefined }
                );
            }
            return planRes;
        },
        onSuccess: () => {
            toast({
                title: release ? "Order planned & released" : "Order planned",
                description: order?.order_number,
            });
            onCommitted?.();
            onClose();
        },
        onError: (err: any) => {
            toast({
                title: "Plan failed",
                description: err?.message || "An error occurred",
                variant: "destructive",
            });
        },
    });

    if (!order) return null;

    const hasOptions = visibleOptions.length > 0;
    const modeInventoryLabel =
        mode === "FG"
            ? "FG"
            : mode === "WIP_CONTINUE"
              ? "carry-forward WIP"
              : mode === "SHARED_INVARIANT"
                ? "invariant stock"
                : mode === "UPSTREAM_STOCK"
                  ? "input stock"
                  : "inventory";
    const canSubmit =
        !planMutation.isPending &&
        missingRouteDispatchSteps.length === 0 &&
        (!requiresAlloc || (hasOptions && totalAllocated > 0));

    return (
        <div
            role="dialog"
            aria-modal="true"
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(11, 31, 85, .42)",
                backdropFilter: "blur(4px)",
                zIndex: "var(--z-modal)" as any,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: "var(--surface-1)",
                    borderRadius: "var(--r-5)",
                    boxShadow: "var(--sh-lg)",
                    maxWidth: 720,
                    width: "100%",
                    maxHeight: "calc(100vh - 48px)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "20px 24px",
                        borderBottom: "1px solid var(--border-soft)",
                        background: "linear-gradient(135deg, var(--br-50) 0%, var(--i-50) 100%)",
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: ".06em",
                                    color: "var(--br-700)",
                                }}
                            >
                                Release planning
                            </div>
                            <div
                                style={{
                                    fontFamily: "var(--f-display)",
                                    fontSize: 22,
                                    fontWeight: 700,
                                    color: "var(--text-1)",
                                    marginTop: 4,
                                }}
                            >
                                {order.order_number}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                                {order.template_name} · {fmt(requiredKg)} {order.qty_uom || "KG"} required
                                {(order as any).customer_name && ` · ${(order as any).customer_name}`}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            style={{
                                background: "rgba(255,255,255,.7)",
                                border: "1px solid var(--border-soft)",
                                borderRadius: "var(--r-pill)",
                                padding: 6,
                                cursor: "pointer",
                                color: "var(--text-2)",
                            }}
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
                    {/* Mode picker */}
                    <div style={{ marginBottom: 18 }}>
                        <div
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: ".06em",
                                color: "var(--text-3)",
                                marginBottom: 8,
                            }}
                        >
                            Source path
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8 }}>
                            <ModeTile
                                mode="FG"
                                active={mode === "FG"}
                                disabled={fgOptions.length === 0}
                                title="FG match"
                                count={fgOptions.length}
                                detail={fgOptions.length > 0 ? "Ship from finished stock" : "No FG candidates"}
                                onClick={() => setMode("FG")}
                            />
                            <ModeTile
                                mode="WIP"
                                active={mode === "WIP_CONTINUE"}
                                disabled={wipOptions.length === 0}
                                title="Carry WIP"
                                count={wipOptions.length}
                                detail={wipOptions.length > 0 ? "Same-order WIP" : "No WIP candidates"}
                                onClick={() => setMode("WIP_CONTINUE")}
                            />
                            <ModeTile
                                mode="WIP"
                                active={mode === "SHARED_INVARIANT"}
                                disabled={sharedInvariantOptions.length === 0}
                                title="Invariant stock"
                                count={sharedInvariantOptions.length}
                                detail={sharedInvariantOptions.length > 0 ? "Reusable semi-finished stock" : "No invariant stock"}
                                onClick={() => setMode("SHARED_INVARIANT")}
                            />
                            <ModeTile
                                mode="WIP"
                                active={mode === "UPSTREAM_STOCK"}
                                disabled={upstreamInputOptions.length === 0}
                                title="Input stock"
                                count={upstreamInputOptions.length}
                                detail={upstreamInputOptions.length > 0 ? "Feed the first required step" : "No input stock"}
                                onClick={() => setMode("UPSTREAM_STOCK")}
                            />
                            <ModeTile
                                mode="FRESH"
                                active={mode === "FRESH"}
                                disabled={false}
                                title="Fresh run"
                                count={0}
                                detail="Schedule a new production run"
                                onClick={() => setMode("FRESH")}
                            />
                        </div>
                    </div>

                    {/* Allocation list */}
                    {requiresAlloc && (
                        <div style={{ marginBottom: 18 }}>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "baseline",
                                    marginBottom: 8,
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: ".06em",
                                        color: "var(--text-3)",
                                    }}
                                >
                                    Inventory candidates
                                </div>
                                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                                    Allocated{" "}
                                    <strong style={{ fontFamily: "var(--f-mono)", color: totalAllocated > 0 ? "var(--success)" : "var(--text-2)" }}>
                                        {fmt(totalAllocated)} KG
                                    </strong>{" "}
                                    of {fmt(requiredKg)} KG
                                </div>
                            </div>

                            {selectedIsWipContinuation && totalAllocated > 0 && (
                                <div
                                    style={{
                                        marginBottom: 10,
                                        padding: "10px 12px",
                                        background: remainingAfterSelectedRun > 0 ? "rgba(245,158,11,.09)" : "rgba(16,185,129,.10)",
                                        border: `1px solid ${remainingAfterSelectedRun > 0 ? "rgba(245,158,11,.32)" : "rgba(16,185,129,.28)"}`,
                                        borderRadius: "var(--r-3)",
                                        fontSize: 11,
                                        color: "var(--text-2)",
                                    }}
                                >
                                    <div style={{ fontWeight: 800, color: remainingAfterSelectedRun > 0 ? "var(--warning)" : "var(--success)" }}>
                                        Execute {fmt(totalAllocated)} KG from selected WIP
                                    </div>
                                    <div style={{ marginTop: 3 }}>
                                        Route will run step {routeRange.start + 1} to {routeRange.stop + 1}.
                                        {remainingAfterSelectedRun > 0
                                            ? ` ${fmt(remainingAfterSelectedRun)} KG remains on this line after this WIP run completes.`
                                            : " Selected WIP covers the full open demand."}
                                    </div>
                                </div>
                            )}

                            {mode === "UPSTREAM_STOCK" && totalAllocated > 0 && (
                                <div
                                    style={{
                                        marginBottom: 10,
                                        padding: "10px 12px",
                                        background: "rgba(245,158,11,.09)",
                                        border: "1px solid rgba(245,158,11,.32)",
                                        borderRadius: "var(--r-3)",
                                        fontSize: 11,
                                        color: "var(--text-2)",
                                    }}
                                >
                                    <div style={{ fontWeight: 800, color: "var(--warning)" }}>
                                        Input stock pre-selected for WCM
                                    </div>
                                    <div style={{ marginTop: 3 }}>
                                        This feeds the first required roll-input step. WCM still validates every required layer roll before machine release.
                                    </div>
                                </div>
                            )}

                            {visibleOptions.length === 0 ? (
                                <div
                                    style={{
                                        padding: "16px 18px",
                                        background: "var(--surface-2)",
                                        borderRadius: "var(--r-3)",
                                        textAlign: "center",
                                        fontSize: 12,
                                        color: "var(--text-3)",
                                    }}
                                >
                                    No {modeInventoryLabel} candidates exist for this spec.
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {visibleOptions.map((opt) => {
                                        const key = `${opt.inventory_type}:${opt.inventory_id}`;
                                        const value = allocations[key] || "";
                                        const allocatable = Number(opt.allocatable_qty_kg || 0);
                                        const onChange = (v: string) =>
                                            setAllocations((s) => ({ ...s, [key]: v }));
                                        const onMaxClick = () => onChange(String(allocatable));
                                        return (
                                            <div
                                                key={key}
                                                style={{
                                                    padding: "12px 14px",
                                                    background: "var(--surface-1-soft)",
                                                    border: "1px solid var(--border-soft)",
                                                    borderRadius: "var(--r-3)",
                                                }}
                                            >
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                                            <span
                                                                style={{
                                                                    fontFamily: "var(--f-mono)",
                                                                    fontSize: 12,
                                                                    fontWeight: 700,
                                                                    color: "var(--text-1)",
                                                                }}
                                                            >
                                                                {opt.display_name || opt.label}
                                                            </span>
                                                            <Chip kind={opt.inventory_type === "FG_BATCH" ? "fg-pouch" : "fg-roll"}>
                                                                {opt.inventory_type === "FG_BATCH" ? "FG batch" : "Roll"}
                                                            </Chip>
                                                            {opt.process_state_label && (
                                                                <Chip kind="brand">{opt.process_state_label}</Chip>
                                                            )}
                                                        </div>
                                                        {(opt.family_display_name || opt.size_line) && (
                                                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                                                                {[opt.family_display_name, opt.size_line].filter(Boolean).join(" · ")}
                                                            </div>
                                                        )}
                                                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, fontFamily: "var(--f-mono)" }}>
                                                            On hand: {fmt(opt.quantity_kg)} KG · Allocatable:{" "}
                                                            <strong style={{ color: "var(--text-1)" }}>{fmt(allocatable)} KG</strong>
                                                        </div>
                                                        {optionPickLocation(opt) && (
                                                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                                                                Pick from <strong style={{ color: "var(--text-1)" }}>{optionPickLocation(opt)}</strong>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
                                                        <div style={{ display: "flex", gap: 4 }}>
                                                            <input
                                                                type="number"
                                                                value={value}
                                                                onChange={(e) => onChange(e.target.value)}
                                                                placeholder="0"
                                                                min={0}
                                                                max={allocatable}
                                                                step={0.01}
                                                                style={{
                                                                    width: "100%",
                                                                    padding: "6px 8px",
                                                                    fontSize: 13,
                                                                    fontFamily: "var(--f-mono)",
                                                                    fontWeight: 700,
                                                                    border: "1px solid var(--border-soft)",
                                                                    borderRadius: "var(--r-2)",
                                                                    outline: "none",
                                                                    textAlign: "right",
                                                                    color: "var(--text-1)",
                                                                    background: "var(--surface-1)",
                                                                }}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={onMaxClick}
                                                                style={{
                                                                    fontSize: 10,
                                                                    fontWeight: 700,
                                                                    padding: "6px 8px",
                                                                    border: "1px solid var(--border-soft)",
                                                                    borderRadius: "var(--r-2)",
                                                                    cursor: "pointer",
                                                                    background: "var(--surface-1)",
                                                                    color: "var(--text-2)",
                                                                }}
                                                                title="Use max allocatable"
                                                            >
                                                                MAX
                                                            </button>
                                                        </div>
                                                        <div style={{ fontSize: 9, color: "var(--text-4)", textAlign: "right", fontFamily: "var(--f-mono)" }}>
                                                            KG to allocate
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {routeDispatchSteps.length > 0 && (
                        <div
                            style={{
                                marginBottom: 18,
                                padding: "14px 16px",
                                background: "var(--surface-1-soft)",
                                border: `1px solid ${missingRouteDispatchSteps.length > 0 ? "rgba(245,158,11,.34)" : "var(--border-soft)"}`,
                                borderRadius: "var(--r-3)",
                                boxShadow: "var(--sh-flat)",
                            }}
                        >
                            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
                                <MapPin size={15} color={missingRouteDispatchSteps.length > 0 ? "var(--warning)" : "var(--br-700)"} style={{ marginTop: 1 }} />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-1)" }}>
                                        Route dispatch
                                    </div>
                                    <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-3)" }}>
                                        Choose the work center for planner-decided route steps before jobs are created.
                                    </div>
                                </div>
                                <span
                                    style={{
                                        padding: "2px 8px",
                                        borderRadius: "var(--r-pill)",
                                        background: missingRouteDispatchSteps.length > 0 ? "rgba(245,158,11,.12)" : "rgba(16,185,129,.12)",
                                        color: missingRouteDispatchSteps.length > 0 ? "var(--warning)" : "var(--success)",
                                        fontSize: 10,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: ".04em",
                                    }}
                                >
                                    {missingRouteDispatchSteps.length > 0 ? `${missingRouteDispatchSteps.length} missing` : "selected"}
                                </span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {routeDispatchSteps.map((step) => {
                                    const idx = stepIndex(step);
                                    const candidates = routeDispatchCandidates(step);
                                    const value = routeDispatchChoiceFor(step);
                                    const policy = routeDispatchPolicy(step);
                                    return (
                                        <div
                                            key={`${idx}:${step.process_code}`}
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "minmax(0, 1fr) minmax(180px, 260px)",
                                                gap: 10,
                                                alignItems: "center",
                                                padding: "10px 12px",
                                                border: "1px solid var(--border-soft)",
                                                borderRadius: "var(--r-2)",
                                                background: "var(--surface-1)",
                                            }}
                                        >
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {routeDispatchStepLabel(step)}
                                                </div>
                                                <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>
                                                    {policy === "PLANNER_REQUIRED" ? "Planner decision required" : "Multiple capable centers"}
                                                </div>
                                            </div>
                                            <select
                                                value={value}
                                                onChange={(e) => {
                                                    const nextValue = e.target.value;
                                                    setWorkCenterOverrides((current) => ({ ...current, [idx]: nextValue }));
                                                }}
                                                style={{
                                                    width: "100%",
                                                    padding: "8px 10px",
                                                    fontSize: 12,
                                                    fontFamily: "var(--f-ui)",
                                                    color: value ? "var(--text-1)" : "var(--text-3)",
                                                    background: "var(--surface-1)",
                                                    border: `1px solid ${value ? "var(--border-soft)" : "rgba(245,158,11,.45)"}`,
                                                    borderRadius: "var(--r-2)",
                                                    outline: "none",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <option value="">Choose work center</option>
                                                {candidates.map((wc) => (
                                                    <option key={wc.id} value={wc.id}>
                                                        {wc.label || `${wc.code} - ${wc.name}`}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                            {missingRouteDispatchSteps.length > 0 && (
                                <div style={{ marginTop: 10, fontSize: 11, color: "var(--warning)", fontWeight: 700 }}>
                                    Release is blocked until every planner-decided route step has a work center.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Fresh-run note */}
                    {!requiresAlloc && (
                        <div
                            style={{
                                padding: "14px 16px",
                                background: "var(--surface-2)",
                                borderRadius: "var(--r-3)",
                                fontSize: 12,
                                color: "var(--text-2)",
                                marginBottom: 18,
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                            }}
                        >
                            <Package size={14} color="var(--br-700)" style={{ marginTop: 1 }} />
                            <div>
                                <strong style={{ color: "var(--text-1)" }}>Fresh production run</strong>
                                <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-3)" }}>
                                    Schedule a brand-new run on the configured route. No prior inventory consumed.
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Release toggle */}
                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 14px",
                            background: release ? "var(--br-50)" : "var(--surface-2)",
                            border: `1px solid ${release ? "var(--br-200)" : "var(--border-soft)"}`,
                            borderRadius: "var(--r-3)",
                            cursor: "pointer",
                            transition: "all var(--df) var(--eo)",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={release}
                            onChange={(e) => setRelease(e.target.checked)}
                            style={{ width: 16, height: 16, accentColor: "var(--brand-600)" }}
                        />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                                Release immediately after planning
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                                Hands the order off to WCM. Uncheck to plan only and release later.
                            </div>
                        </div>
                    </label>
                </div>

                {/* Footer */}
                <div
                    style={{
                        padding: "16px 24px",
                        borderTop: "1px solid var(--border-soft)",
                        background: "var(--surface-1-soft)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {missingRouteDispatchSteps.length > 0 ? (
                            <span style={{ color: "var(--warning)", fontWeight: 700 }}>
                                Choose {missingRouteDispatchSteps.length} route work center{missingRouteDispatchSteps.length === 1 ? "" : "s"} to proceed
                            </span>
                        ) : requiresAlloc ? (
                            totalAllocated >= requiredKg ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--success)" }}>
                                    <CheckCircle2 size={12} />
                                    {expectedReturnKg > 0
                                        ? `Execute ${fmt(requiredKg)} KG · return ${fmt(expectedReturnKg)} KG`
                                        : "Fully allocated"}
                                </span>
                            ) : selectedIsWipContinuation && totalAllocated > 0 ? (
                                <span style={{ color: "var(--warning)" }}>
                                    Execute {fmt(executionKg)} KG now · {fmt(remainingAfterSelectedRun)} KG remains
                                </span>
                            ) : totalAllocated > 0 ? (
                                <span style={{ color: "var(--warning)" }}>
                                    Short by {fmt(requiredKg - totalAllocated)} KG
                                </span>
                            ) : (
                                <span>Allocate at least one candidate to proceed</span>
                            )
                        ) : (
                            "Fresh run will use the full template route"
                        )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="ghost" onClick={onClose} disabled={planMutation.isPending}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => planMutation.mutate()}
                            disabled={!canSubmit}
                        >
                            <Rocket size={14} style={{ marginRight: 6 }} />
                            {release ? "Plan & Release" : "Plan only"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ModeTile({
    mode,
    active,
    disabled,
    title,
    count,
    detail,
    onClick,
}: {
    mode: "FG" | "WIP" | "FRESH";
    active: boolean;
    disabled: boolean;
    title: string;
    count: number;
    detail: string;
    onClick: () => void;
}) {
    const accent = mode === "FG" ? "success" : mode === "WIP" ? "info" : "brand";
    const colors = {
        success: { bg: "rgba(16,185,129,.10)", fg: "var(--success)", border: "rgba(16,185,129,.30)" },
        info: { bg: "rgba(99,102,241,.10)", fg: "var(--i-700)", border: "rgba(99,102,241,.30)" },
        brand: { bg: "rgba(37,99,235,.08)", fg: "var(--br-700)", border: "rgba(37,99,235,.24)" },
    }[accent];
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={{
                padding: "12px 14px",
                background: active ? colors.bg : "var(--surface-1)",
                border: `2px solid ${active ? colors.fg : "var(--border-soft)"}`,
                borderRadius: "var(--r-3)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.45 : 1,
                textAlign: "left",
                position: "relative",
                transition: "all var(--df) var(--eo)",
            }}
        >
            <div
                style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    color: active ? colors.fg : "var(--text-3)",
                }}
            >
                {title}
            </div>
            <div
                style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--text-1)",
                    marginTop: 4,
                }}
            >
                {count > 0 ? count : "—"}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{detail}</div>
        </button>
    );
}

export default InventorySelectDialog;
