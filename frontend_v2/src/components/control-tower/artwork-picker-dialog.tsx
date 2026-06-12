"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Image as ImageIcon, Search, X } from "lucide-react";

import { plannerService, type PlannerControlOrder, type PlannerOrderKind } from "@/services/planner";
import { engineeringService, type Artwork } from "@/services/engineering";
import { productMasterService } from "@/services/product-master";
import { useToast } from "@/hooks/use-toast";
import { Button, Chip } from "@/components/_planner-ui";

interface ArtworkPickerDialogProps {
    order: PlannerControlOrder | null;
    onClose: () => void;
}

export function ArtworkPickerDialog({ order, onClose }: ArtworkPickerDialogProps) {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [search, setSearch] = useState("");
    const [selectedArtworkId, setSelectedArtworkId] = useState<string>("");
    const [selectedItemId, setSelectedItemId] = useState<string>("");

    const pendingItems = order?.pending_artwork_items || [];
    const pendingItemsKey = pendingItems.map((it: any) => `${it.id}:${it.product_master_id || ""}:${JSON.stringify(it.axis_values || {})}`).join("|");
    useEffect(() => {
        setSelectedArtworkId("");
        setSelectedItemId((current) => {
            if (!pendingItems.length) return "";
            if (current && pendingItems.some((it: any) => it.id === current)) return current;
            return String(pendingItems[0]?.id || "");
        });
    }, [order?.order_id, pendingItemsKey]);

    const selectedPendingItem = useMemo(() => {
        if (!pendingItems.length) return null;
        return pendingItems.find((it: any) => it.id === selectedItemId) || pendingItems[0] || null;
    }, [pendingItems, selectedItemId]);
    const orderPrinting = order?.printing_snapshot || {};
    const axisValues = selectedPendingItem?.axis_values && typeof selectedPendingItem.axis_values === "object"
        ? selectedPendingItem.axis_values
        : {};
    const axisValuesKey = JSON.stringify(axisValues);
    const activeProductMasterId = selectedPendingItem?.product_master_id || (order as any)?.product_master_id || null;
    const printType = selectedPendingItem?.print_type || orderPrinting.print_type || orderPrinting.type || orderPrinting.method;
    const substrateMode = selectedPendingItem?.substrate_mode || orderPrinting.substrate_mode || orderPrinting.film_type;

    const artworksQ = useQuery({
        queryKey: [
            "artworks-picker",
            activeProductMasterId || "no-product-master",
            axisValuesKey,
            printType || "",
            substrateMode || "",
        ],
        queryFn: async () => {
            const snapshotFallback = async (reason = "") => {
                const results = await engineeringService.getArtworks({
                    status: "APPROVED",
                    ...(printType ? { print_type: printType } : {}),
                    ...(substrateMode ? { substrate_mode: substrateMode } : {}),
                });
                return {
                    count: results.length,
                    results,
                    context: { print_type: printType || null, substrate_mode: substrateMode || null },
                    needs_size: false,
                    reason,
                };
            };

            if (activeProductMasterId) {
                const response = await productMasterService.compatibleArtworks(activeProductMasterId, {
                    status: "APPROVED",
                    axis_values: axisValues,
                });
                if (response.results.length || !printType || !substrateMode) return response;
                return snapshotFallback(response.reason || "No Product Master-compatible artwork; showing approved matches for this line snapshot.");
            }
            return snapshotFallback();
        },
        enabled: !!order,
        staleTime: 60_000,
    });

    const artworks: Artwork[] = artworksQ.data?.results || [];
    const filtered = useMemo(() => {
        if (!search) return artworks;
        const q = search.toLowerCase();
        return artworks.filter((a) => `${a.design_code} ${a.name}`.toLowerCase().includes(q));
    }, [artworks, search]);

    const assignMut = useMutation({
        mutationFn: async () => {
            if (!order || !selectedArtworkId) throw new Error("Pick an artwork");
            return plannerService.assignArtworkToOrder(order.order_kind as PlannerOrderKind, order.order_id, {
                artwork_id: selectedArtworkId,
                item_id: selectedItemId || undefined,
            });
        },
        onSuccess: () => {
            toast({ title: "Artwork assigned", description: order?.order_number });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-pq-v3"] });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-pq-detail-v1"] });
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-ct-v3"] });
            onClose();
        },
        onError: (err: any) => {
            toast({ title: "Assign failed", description: err?.message || "An error occurred", variant: "destructive" });
        },
    });

    if (!order) return null;

    return (
        <div
            role="dialog" aria-modal="true"
            data-testid="planner-artwork-picker-dialog"
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
                    background: "var(--surface-1)", borderRadius: "var(--r-5)",
                    boxShadow: "var(--sh-lg)", maxWidth: 720, width: "100%",
                    maxHeight: "calc(100vh - 48px)", overflow: "hidden",
                    display: "flex", flexDirection: "column",
                }}
            >
                <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-soft)", background: "var(--surface-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--v-700)" }}>
                                Assign artwork
                            </div>
                            <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 700, color: "var(--text-1)", marginTop: 4 }}>
                                {order.order_number}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                                {printType ? `${printType} · ${substrateMode || "form"} · artwork decides colors` : "no print profile set"} · {order.template_name}
                            </div>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Close" style={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-pill)", padding: 6, cursor: "pointer", color: "var(--text-2)" }}>
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div style={{ padding: 20, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
                    {pendingItems.length > 1 && (
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)", marginBottom: 6 }}>
                                Pending items
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {pendingItems.map((it: any) => (
                                    <button
                                        key={it.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedItemId(it.id);
                                            setSelectedArtworkId("");
                                        }}
                                        style={{
                                            padding: "6px 12px",
                                            fontSize: 11,
                                            fontWeight: 600,
                                            background: selectedItemId === it.id ? "var(--brand-600)" : "var(--surface-2)",
                                            color: selectedItemId === it.id ? "var(--text-on-brand)" : "var(--text-2)",
                                            border: "1px solid " + (selectedItemId === it.id ? "var(--brand-600)" : "var(--border-soft)"),
                                            borderRadius: "var(--r-pill)",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {it.label || it.line_name || it.id.slice(0, 8)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ position: "relative" }}>
                        <Search size={12} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                        <input
                            type="text" value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by design code or name"
                            style={{
                                width: "100%", padding: "10px 12px 10px 32px",
                                fontSize: 13, fontFamily: "var(--f-ui)",
                                background: "var(--surface-1)", border: "1px solid var(--border-soft)",
                                borderRadius: "var(--r-pill)", outline: "none",
                            }}
                        />
                    </div>

                    {artworksQ.isLoading ? (
                        <div style={{ padding: 32, textAlign: "center", color: "var(--text-4)" }}>Loading artworks…</div>
                    ) : filtered.length === 0 ? (
                        <div style={{ padding: 32, textAlign: "center", color: "var(--text-4)", background: "var(--surface-2)", borderRadius: "var(--r-3)" }}>
                            {artworksQ.data?.reason || `No compatible approved artwork for ${printType || "this print method"} ${substrateMode ? `· ${substrateMode}` : ""}.`}
                            <br />
                            <small>Planner filters by current Product Master, selected size, print type, and sheet/tube form.</small>
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, maxHeight: 380, overflowY: "auto" }}>
                            {filtered.slice(0, 30).map((a) => {
                                const selected = a.id === selectedArtworkId;
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        data-testid={`planner-artwork-option-${a.id}`}
                                        data-artwork-code={a.design_code}
                                        onClick={() => setSelectedArtworkId(a.id)}
                                        style={{
                                            textAlign: "left",
                                            padding: 10,
                                            background: selected ? "var(--br-50)" : "var(--surface-1)",
                                            border: `2px solid ${selected ? "var(--brand-600)" : "var(--border-soft)"}`,
                                            borderRadius: "var(--r-3)",
                                            cursor: "pointer",
                                            position: "relative",
                                            transition: "all var(--df) var(--eo)",
                                        }}
                                    >
                                        {selected && (
                                            <CheckCircle2 size={14} color="var(--brand-600)" style={{ position: "absolute", top: 8, right: 8 }} />
                                        )}
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                            <div style={{ width: 32, height: 32, borderRadius: "var(--r-2)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                                                {a.image ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={a.image} alt={a.design_code} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                ) : (
                                                    <ImageIcon size={14} color="var(--text-4)" />
                                                )}
                                            </div>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-1)" }}>
                                                    {a.design_code}
                                                </div>
                                                <div style={{ fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {a.name}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                            {a.print_type && <Chip kind="print">{a.print_type}</Chip>}
                                            {a.colors_count != null && <Chip kind="brand">{a.colors_count} colors</Chip>}
                                            {String(a.print_type || "").toUpperCase() === "ROTO" ? (
                                                <Chip kind={a.cylinder_ready ? "ready" : "blocked"}>
                                                    {a.cylinder_ready ? "cylinder" : "cylinder pending"}
                                                </Chip>
                                            ) : (
                                                <Chip kind="ready">no cylinder needed</Chip>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-soft)", background: "var(--surface-1-soft)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {selectedArtworkId ? "Ready to assign" : "Pick an artwork to continue"}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="ghost" onClick={onClose} disabled={assignMut.isPending}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            data-testid="planner-confirm-artwork-assign"
                            disabled={!selectedArtworkId || assignMut.isPending}
                            onClick={() => assignMut.mutate()}
                        >
                            Assign artwork
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ArtworkPickerDialog;
