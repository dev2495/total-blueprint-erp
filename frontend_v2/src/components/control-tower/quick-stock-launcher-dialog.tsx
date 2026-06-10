"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Plus, Rocket, X, Zap } from "lucide-react";

import { plannerService, type CreateStockOrderPayload } from "@/services/planner";
import { useToast } from "@/hooks/use-toast";
import { Button, Chip } from "@/components/_planner-ui";

export interface QuickStockLauncherSeed {
    template_id?: string;
    template_name?: string;
    fg_type?: string;
    geometry_snapshot?: any;
    layer_snapshot?: any[];
    printing_snapshot?: any;
    addons_snapshot?: any[];
    packaging_snapshot?: any;
    suggested_qty_kg?: number;
    deficit_kg?: number;
    stock_purpose?: "PRODUCT" | "PACKAGING";
    label?: string;
    plant_id?: string | null;
}

interface QuickStockLauncherDialogProps {
    seed: QuickStockLauncherSeed | null;
    onClose: () => void;
    onCommitted?: () => void;
}

/**
 * QuickStockLauncherDialog — fast inline launcher for stock orders.
 * Bypasses the release flow: posts auto_release=true so the order goes
 * straight from PLANNING_REQUIRED → PLANNED → RELEASED in one shot, with the
 * first job released to production. No artwork gate (planner stock launcher).
 */
export function QuickStockLauncherDialog({ seed, onClose, onCommitted }: QuickStockLauncherDialogProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [qty, setQty] = useState<string>("");
    const [autoRelease, setAutoRelease] = useState<boolean>(true);

    useEffect(() => {
        if (!seed) return;
        // Default qty: deficit if known, else suggested, else round number
        const v = seed.deficit_kg ?? seed.suggested_qty_kg ?? 100;
        setQty(String(Math.max(1, Math.round(Number(v) || 100))));
        setAutoRelease(true);
    }, [seed?.template_id, seed?.label]);

    const mutation = useMutation({
        mutationFn: async () => {
            if (!seed) throw new Error("No seed");
            const qtyNum = Number(qty);
            if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new Error("Quantity must be > 0");

            const payload: CreateStockOrderPayload & { auto_release?: boolean } = {
                template_id: seed.template_id,
                quantity: qtyNum,
                quantity_uom: "KG",
                stock_purpose: seed.stock_purpose || "PRODUCT",
                start_step_index: 0,
                geometry_snapshot: seed.geometry_snapshot,
                layer_snapshot: seed.layer_snapshot,
                printing_snapshot: seed.printing_snapshot,
                addons_snapshot: seed.addons_snapshot,
                packaging_snapshot: seed.packaging_snapshot,
                preferred_plant_id: seed.plant_id || undefined,
                auto_release: autoRelease,
            } as any;

            return plannerService.createStockOrder(payload);
        },
        onSuccess: (res: any) => {
            const released = !!res?.auto_released;
            toast({
                title: released ? "Stock order released to production" : "Stock order planned",
                description: `${res?.order_number || "Created"} · ${res?.quantity_kg || qty} KG`,
            });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-pq-v3"] });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-pq-detail-v1"] });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-ct-v3"] });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-si-v4"] });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-lp-v3"] });
            queryClient.invalidateQueries({ queryKey: ["planner-stock-si-v3"] });
            queryClient.invalidateQueries({ queryKey: ["planner-jobs-si-v3"] });
            queryClient.invalidateQueries({ queryKey: ["planner-jobs-lp-v2"] });
            onCommitted?.();
            onClose();
        },
        onError: (err: any) => {
            toast({
                title: "Stock order failed",
                description: err?.response?.data?.error || err?.message || "An error occurred",
                variant: "destructive",
            });
        },
    });

    if (!seed) return null;

    const hasFullSnap = !!(seed.template_id && seed.geometry_snapshot && Array.isArray(seed.layer_snapshot) && seed.layer_snapshot.length > 0);
    const fgType = String(seed.fg_type || "").toUpperCase();
    const purposeLabel = (seed.stock_purpose || "PRODUCT") === "PACKAGING" ? "Packaging stock" : "Product stock";

    return (
        <div
            role="dialog" aria-modal="true"
            onClick={onClose}
            style={{
                position: "fixed", inset: 0, padding: 24, zIndex: 50,
                background: "rgba(11, 31, 85, .42)", backdropFilter: "blur(4px)",
                display: "flex", alignItems: "center", justifyContent: "center",
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: "var(--surface-1)",
                    borderRadius: "var(--r-5)",
                    boxShadow: "var(--sh-lg)",
                    maxWidth: 560, width: "100%",
                    overflow: "hidden",
                }}
            >
                {/* Header */}
                <div style={{
                    padding: "20px 24px",
                    borderBottom: "1px solid var(--border-soft)",
                    background: "linear-gradient(135deg, var(--br-50) 0%, var(--v-50) 100%)",
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <Zap size={12} color="var(--br-700)" />
                                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--br-700)" }}>
                                    Quick stock launcher
                                </span>
                            </div>
                            <div style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 700, color: "var(--text-1)", marginTop: 4, lineHeight: 1.2 }}>
                                {seed.label || seed.template_name || "Stock order"}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                                {fgType && <Chip kind={fgType.includes("ROLL") ? "fg-roll" : "fg-pouch"}>{fgType}</Chip>}
                                <Chip kind="brand">{purposeLabel}</Chip>
                                {seed.deficit_kg != null && seed.deficit_kg > 0 && (
                                    <Chip kind="blocked">deficit {Math.round(seed.deficit_kg)} KG</Chip>
                                )}
                            </div>
                        </div>
                        <button
                            type="button" onClick={onClose} aria-label="Close"
                            style={{
                                background: "rgba(255,255,255,.7)", border: "1px solid var(--border-soft)",
                                borderRadius: "var(--r-pill)", padding: 6, cursor: "pointer", color: "var(--text-2)",
                            }}
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                    {!hasFullSnap && (
                        <div style={{
                            padding: "12px 14px",
                            background: "rgba(245,158,11,.08)",
                            border: "1px solid rgba(245,158,11,.22)",
                            borderRadius: "var(--r-3)",
                            fontSize: 12, color: "var(--text-2)",
                            display: "flex", gap: 10, alignItems: "flex-start",
                        }}>
                            <ExternalLink size={14} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
                            <div>
                                Quick launch needs a full template + geometry + layer snapshot. This template doesn&apos;t carry one in the Stock Intelligence aggregation.
                                Use the full <strong>Stock Order Launcher</strong> page instead — link below.
                            </div>
                        </div>
                    )}

                    {/* Quantity */}
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)", marginBottom: 6 }}>
                            Quantity to build
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                            <input
                                type="number" min={1} step={1}
                                value={qty}
                                onChange={(e) => setQty(e.target.value)}
                                placeholder="0"
                                style={{
                                    flex: 1, padding: "12px 14px",
                                    fontSize: 18, fontFamily: "var(--f-display)", fontWeight: 700,
                                    color: "var(--text-1)",
                                    background: "var(--surface-2)",
                                    border: "1px solid var(--border-soft)",
                                    borderRadius: "var(--r-3)",
                                    outline: "none",
                                }}
                            />
                            <span style={{
                                display: "inline-flex", alignItems: "center", padding: "0 14px",
                                fontSize: 14, fontWeight: 700, color: "var(--text-3)",
                                background: "var(--surface-2)",
                                border: "1px solid var(--border-soft)",
                                borderRadius: "var(--r-3)",
                            }}>KG</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            {[100, 250, 500, 1000, 2000].map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => setQty(String(v))}
                                    style={{
                                        padding: "4px 10px",
                                        fontSize: 11, fontWeight: 600,
                                        background: qty === String(v) ? "var(--brand-600)" : "var(--surface-2)",
                                        color: qty === String(v) ? "var(--text-on-brand)" : "var(--text-2)",
                                        border: `1px solid ${qty === String(v) ? "var(--brand-600)" : "var(--border-soft)"}`,
                                        borderRadius: "var(--r-pill)",
                                        cursor: "pointer",
                                    }}
                                >
                                    {v}
                                </button>
                            ))}
                            {seed.deficit_kg != null && seed.deficit_kg > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setQty(String(Math.ceil(seed.deficit_kg!)))}
                                    style={{
                                        padding: "4px 10px",
                                        fontSize: 11, fontWeight: 700,
                                        background: "rgba(244,63,94,.10)",
                                        color: "var(--danger)",
                                        border: "1px solid rgba(244,63,94,.24)",
                                        borderRadius: "var(--r-pill)",
                                        cursor: "pointer",
                                    }}
                                >
                                    Cover deficit ({Math.ceil(seed.deficit_kg)})
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Auto-release toggle */}
                    <label style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 14px",
                        background: autoRelease ? "linear-gradient(135deg, rgba(37,99,235,.08), rgba(99,102,241,.08))" : "var(--surface-2)",
                        border: `1px solid ${autoRelease ? "var(--br-200)" : "var(--border-soft)"}`,
                        borderRadius: "var(--r-3)",
                        cursor: "pointer",
                    }}>
                        <input
                            type="checkbox"
                            checked={autoRelease}
                            onChange={(e) => setAutoRelease(e.target.checked)}
                            style={{ width: 18, height: 18, accentColor: "var(--brand-600)" }}
                        />
                        <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <Rocket size={13} color={autoRelease ? "var(--br-700)" : "var(--text-3)"} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                                    Send straight to production
                                </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                                Stock launcher orders bypass the release gate — first job is released immediately. No artwork gate.
                            </div>
                        </div>
                    </label>

                    {/* Note */}
                    <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
                        For full configuration (custom layers, plant, route stop, POD targeting, commitment scope) use the{" "}
                        <a href="/production/planner/stock-launcher" style={{ color: "var(--link)", fontWeight: 700 }}>
                            full Stock Order Launcher (V3) →
                        </a>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: "16px 24px",
                    borderTop: "1px solid var(--border-soft)",
                    background: "var(--surface-1-soft)",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {autoRelease ? (
                            <span style={{ color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <CheckCircle2 size={12} /> Will auto-release on submit
                            </span>
                        ) : (
                            "Will create as PLANNED · release later"
                        )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            disabled={mutation.isPending || !hasFullSnap || !qty || Number(qty) <= 0}
                            onClick={() => mutation.mutate()}
                            style={{ boxShadow: hasFullSnap ? "var(--glow-brand)" : "none" }}
                        >
                            {autoRelease ? <Rocket size={14} style={{ marginRight: 6 }} /> : <Plus size={14} style={{ marginRight: 6 }} />}
                            {autoRelease ? "Build & Release" : "Plan only"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default QuickStockLauncherDialog;
