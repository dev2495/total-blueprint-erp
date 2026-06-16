"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Package, Rocket, X } from "lucide-react";

import {
    plannerService,
    type PlannerControlOrder,
    type PlannerOrderKind,
    type PlannerInventoryOption,
} from "@/services/planner";
import { useToast } from "@/hooks/use-toast";
import { Button, Chip } from "@/components/_planner-ui";

interface InventorySelectDialogProps {
    order: PlannerControlOrder | null;
    onClose: () => void;
    onCommitted?: () => void;
}

type Mode = "FG" | "WIP_CONTINUE" | "FRESH";

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

function isReusableSourceOption(option: PlannerInventoryOption) {
    return sourceBucket(option) !== "FINISHED_STOCK";
}

export function InventorySelectDialog({ order, onClose, onCommitted }: InventorySelectDialogProps) {
    const { toast } = useToast();
    const [mode, setMode] = useState<Mode>("FRESH");
    const [allocations, setAllocations] = useState<Record<string, string>>({});
    const [release, setRelease] = useState(true);

    // Reset state when order changes
    useEffect(() => {
        if (!order) return;
        const fgAvail = !!order.source_availability?.has_fg;
        const wipAvail = !!order.source_availability?.has_wip;
        setMode(fgAvail ? "FG" : wipAvail ? "WIP_CONTINUE" : "FRESH");
        setAllocations({});
        setRelease(true);
    }, [order?.order_id, order?.sales_order_item_id]);

    const fgOptions = useMemo<PlannerInventoryOption[]>(() => {
        if (!order) return [];
        return (order.inventory_options || []).filter(isExactFgOption);
    }, [order]);
    const wipOptions = useMemo<PlannerInventoryOption[]>(() => {
        if (!order) return [];
        return (order.inventory_options || []).filter(isReusableSourceOption);
    }, [order]);

    const visibleOptions = mode === "FG" ? fgOptions : mode === "WIP_CONTINUE" ? wipOptions : [];
    const requiredKg = Number(order?.required_qty_kg || 0);

    const totalAllocated = useMemo(() => {
        return Object.values(allocations).reduce((sum, v) => {
            const n = Number(v);
            return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
    }, [allocations]);

    const planMutation = useMutation({
        mutationFn: async () => {
            if (!order) throw new Error("No order");
            const allocList = (mode === "FG" || mode === "WIP_CONTINUE")
                ? Object.entries(allocations)
                      .map(([key, value]) => {
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
                          };
                      })
                      .filter((x): x is { inventory_type: "ROLL" | "FG_BATCH"; inventory_id: string; allocated_qty_kg: number } => x !== null)
                : [];

            const planRes = await plannerService.planOrder(
                order.order_kind as PlannerOrderKind,
                order.order_id,
                { option: mode, allocations: allocList, item_id: order.sales_order_item_id || undefined }
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

    const requiresAlloc = mode === "FG" || mode === "WIP_CONTINUE";
    const hasOptions = visibleOptions.length > 0;
    const canSubmit =
        !planMutation.isPending &&
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
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
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
                                title="WIP convert"
                                count={wipOptions.length}
                                detail={wipOptions.length > 0 ? "Continue from semi-finished" : "No WIP candidates"}
                                onClick={() => setMode("WIP_CONTINUE")}
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
                                    No {mode === "FG" ? "FG" : "WIP"} candidates exist for this spec.
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
                        {requiresAlloc ? (
                            totalAllocated >= requiredKg ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--success)" }}>
                                    <CheckCircle2 size={12} /> Fully allocated
                                </span>
                            ) : totalAllocated > 0 ? (
                                <span style={{ color: "var(--warning)" }}>
                                    Short by {fmt(requiredKg - totalAllocated)} KG (partial OK)
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
