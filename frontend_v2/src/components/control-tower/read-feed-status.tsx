"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/_planner-ui";

type Feed = {
    label: string;
    data: unknown;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
};

export function PlannerReadFeedStatus({ feeds, onRetry }: { feeds: Feed[]; onRetry: () => void }) {
    const failed = feeds.filter((feed) => feed.isError);
    const loading = feeds.filter((feed) => feed.isPending && feed.data === undefined);
    if (!failed.length && !loading.length) return null;
    const refreshing = feeds.some((feed) => feed.isFetching);
    const message = failed.length
        ? `${failed.map((feed) => feed.label).join(", ")} could not refresh. ${failed.some((feed) => feed.data !== undefined) ? "The last loaded data is still shown." : "These feeds are unavailable until the retry succeeds."}`
        : `Loading ${loading.map((feed) => feed.label.toLowerCase()).join(", ")}…`;
    return (
        <div role={failed.length ? "alert" : "status"} aria-live="polite" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "14px 16px", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", background: "var(--surface-2)" }}>
            {failed.length ? <AlertTriangle size={18} aria-hidden="true" /> : <RefreshCw size={18} className="spin" aria-hidden="true" />}
            <span style={{ flex: "1 1 220px", fontSize: 13, color: "var(--text-2)" }}>{message}</span>
            {failed.length > 0 && <Button variant="secondary" onClick={onRetry} disabled={refreshing}>{refreshing ? "Retrying…" : "Retry feeds"}</Button>}
        </div>
    );
}
