// Age + due helpers — the planner's mental model is "days since placed", not "days to due".

export interface AgeInfo {
    days: number;
    label: string;
    tone: "fresh" | "active" | "ageing" | "stale";
    bucket: "0-3d" | "4-7d" | "8-14d" | "15-30d" | "30+d";
}

export function ageInfo(placedAt: string | null | undefined): AgeInfo | null {
    if (!placedAt) return null;
    const t = new Date(placedAt).getTime();
    if (Number.isNaN(t)) return null;
    const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
    let tone: AgeInfo["tone"] = "fresh";
    let bucket: AgeInfo["bucket"] = "0-3d";
    if (days <= 3) { tone = "fresh"; bucket = "0-3d"; }
    else if (days <= 7) { tone = "active"; bucket = "4-7d"; }
    else if (days <= 14) { tone = "active"; bucket = "8-14d"; }
    else if (days <= 30) { tone = "ageing"; bucket = "15-30d"; }
    else { tone = "stale"; bucket = "30+d"; }
    const label = days <= 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
    return { days, label, tone, bucket };
}

export interface DueInfo {
    days: number;
    label: string;
    tone: "danger" | "warn" | "info" | "muted";
}

export function dueInfo(deliveryAt: string | null | undefined): DueInfo {
    if (!deliveryAt) return { days: NaN, label: "no due", tone: "muted" };
    const t = new Date(deliveryAt).getTime();
    if (Number.isNaN(t)) return { days: NaN, label: "no due", tone: "muted" };
    const days = Math.floor((t - Date.now()) / (1000 * 60 * 60 * 24));
    if (days < 0) return { days, label: `${Math.abs(days)}d overdue`, tone: "danger" };
    if (days === 0) return { days, label: "due today", tone: "danger" };
    if (days <= 2) return { days, label: `due in ${days}d`, tone: "warn" };
    if (days <= 7) return { days, label: `due in ${days}d`, tone: "info" };
    return { days, label: `due in ${days}d`, tone: "muted" };
}

export function ageToneColor(tone: AgeInfo["tone"]): { fg: string; bg: string; bgSolid: string } {
    switch (tone) {
        case "fresh": return { fg: "var(--success)", bg: "rgba(16,185,129,.10)", bgSolid: "#10b981" };
        case "active": return { fg: "var(--info)", bg: "rgba(14,165,233,.10)", bgSolid: "#0ea5e9" };
        case "ageing": return { fg: "var(--warning)", bg: "rgba(245,158,11,.10)", bgSolid: "#f59e0b" };
        case "stale": return { fg: "var(--danger)", bg: "rgba(244,63,94,.10)", bgSolid: "#f43f5e" };
    }
}

export function dueToneColor(tone: DueInfo["tone"]): { fg: string; bg: string } {
    switch (tone) {
        case "danger": return { fg: "var(--danger)", bg: "rgba(244,63,94,.10)" };
        case "warn": return { fg: "var(--warning)", bg: "rgba(245,158,11,.10)" };
        case "info": return { fg: "var(--info)", bg: "rgba(14,165,233,.10)" };
        case "muted": return { fg: "var(--text-4)", bg: "var(--surface-2)" };
    }
}
