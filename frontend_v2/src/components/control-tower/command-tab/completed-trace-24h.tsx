"use client";

import Link from "next/link";
import type { PlannerControlOrder } from "@/services/planner";
import { Card, EmptyState, Chip, DataTable } from "@/components/_planner-ui";
import { History } from "lucide-react";

interface CompletedTrace24hProps {
    orders: PlannerControlOrder[]; // history-bucket orders from getControlHub
}

function fmt(n: any, decimals = 1): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function timeAgo(iso?: string | null): string {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "—";
    const ms = Date.now() - t;
    const min = Math.floor(ms / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

export function CompletedTrace24h({ orders }: CompletedTrace24hProps) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = (orders || [])
        .filter((o) => {
            const completed = (o as any).closed_at as string | null | undefined;
            if (!completed) return false;
            const t = new Date(completed).getTime();
            return Number.isFinite(t) && t >= cutoff;
        })
        .sort(
            (a, b) =>
                new Date((b as any).closed_at as string).getTime() -
                new Date((a as any).closed_at as string).getTime()
        )
        .slice(0, 8);

    return (
        <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                    <div className="t-eyebrow">Completed in last 24h</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                        {recent.length} order{recent.length === 1 ? "" : "s"} closed
                    </div>
                </div>
                <Link
                    href="/dashboard/planner/control-tower/completed-trace"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--link)",
                        textDecoration: "none",
                    }}
                >
                    <History size={14} /> Open Completed Trace →
                </Link>
            </div>

            {recent.length === 0 ? (
                <EmptyState
                    title="No completions in the last 24 hours"
                    body="When orders close, they'll appear here with timing and trace links."
                />
            ) : (
                <DataTable
                    columns={[
                        {
                            key: "order_number",
                            header: "Order",
                            cell: (row: any) => (
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 700 }}>
                                    {row.order_number}
                                </span>
                            ),
                        },
                        {
                            key: "template_name",
                            header: "Template",
                            cell: (row: any) => <Chip kind="tpl">{row.template_name || "—"}</Chip>,
                        },
                        {
                            key: "fg_type",
                            header: "Type",
                            cell: (row: any) => {
                                const t = String(row.fg_type || row.final_product_type || "—");
                                return <Chip kind={t.toLowerCase().includes("roll") ? "fg-roll" : "fg-pouch"}>{t}</Chip>;
                            },
                        },
                        {
                            key: "required_qty_kg",
                            header: "Qty",
                            cell: (row: any) => (
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>
                                    {fmt(row.required_qty_kg)} KG
                                </span>
                            ),
                        },
                        {
                            key: "closed_at",
                            header: "Closed",
                            cell: (row: any) => (
                                <span style={{ fontSize: 12, color: "var(--text-3)" }}>{timeAgo(row.closed_at)}</span>
                            ),
                        },
                    ]}
                    rows={recent.map((o: any) => ({
                        order_number: o.order_number,
                        template_name: o.template_name,
                        fg_type: o.fg_type,
                        final_product_type: o.final_product_type,
                        required_qty_kg: o.required_qty_kg,
                        closed_at: o.closed_at,
                    }))}
                />
            )}
        </Card>
    );
}

export default CompletedTrace24h;
