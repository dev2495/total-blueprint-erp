"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function formatMaybeNumber(value: unknown, decimals = 0, locale = "en-IN"): string {
    const numeric = toNullableNumber(value);
    if (numeric === null) return "—";
    return numeric.toLocaleString(locale, { maximumFractionDigits: decimals });
}

export function hasMeaningfulValue(value: unknown): boolean {
    if (value === null || value === undefined || value === "") return false;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return true;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));
    if (typeof value === "object") return Object.values(value as Record<string, unknown>).some((entry) => hasMeaningfulValue(entry));
    return false;
}

export function hasMeaningfulData(values: unknown[]): boolean {
    return values.some((value) => hasMeaningfulValue(value));
}

export function isNonEmptyArray<T>(value: unknown): value is T[] {
    return Array.isArray(value) && value.length > 0;
}

export function coerceRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

export function ReportStateBanner({
    title,
    message,
    tone = "degraded",
    actionLabel,
    onAction,
}: {
    title: string;
    message: string;
    tone?: "degraded" | "empty" | "info";
    actionLabel?: string;
    onAction?: () => void;
}) {
    const toneClasses =
        tone === "empty"
            ? "border-slate-200 bg-slate-50 text-slate-700"
            : tone === "info"
              ? "border-info-border bg-info-bg text-info-fg"
              : "border-warning-border bg-warning-bg text-amber-800";

    return (
        <Card className={`rounded-[1.35rem] ${toneClasses}`}>
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className="rounded-full border border-current/15 bg-white/70 p-2">
                        <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div>
                        <div className="text-sm font-black">{title}</div>
                        <div className="mt-1 text-sm font-medium opacity-80">{message}</div>
                    </div>
                </div>
                {onAction && actionLabel ? (
                    <Button variant="outline" onClick={onAction} className="rounded-full border-current/20 bg-white/80">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {actionLabel}
                    </Button>
                ) : null}
            </CardContent>
        </Card>
    );
}

export function ReportEmptyCard({ title, message }: { title: string; message: string }) {
    return (
        <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-500">
            <div className="text-sm font-black text-slate-700">{title}</div>
            <div className="mt-1 text-sm font-medium text-slate-500">{message}</div>
        </div>
    );
}

export function truthyRecordCount(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
}

export function hasTruthyValue(value: unknown): boolean {
    return value !== null && value !== undefined && value !== "";
}

export function sumNumbers(values: Array<unknown>): number | null {
    if (!values.length) return null;
    let seen = false;
    let total = 0;
    for (const value of values) {
        const numeric = toNullableNumber(value);
        if (numeric === null) continue;
        seen = true;
        total += numeric;
    }
    return seen ? total : null;
}

export function maybeText(value: unknown): string {
    return hasTruthyValue(value) ? String(value) : "—";
}

export function formatMaybeCurrency(value: unknown): string {
    const numeric = toNullableNumber(value);
    if (numeric === null) return "—";
    if (numeric >= 10_000_000) return `₹${(numeric / 10_000_000).toFixed(2)} Cr`;
    if (numeric >= 100_000) return `₹${(numeric / 100_000).toFixed(1)} L`;
    if (numeric >= 1_000) return `₹${(numeric / 1_000).toFixed(1)}K`;
    return `₹${numeric.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
