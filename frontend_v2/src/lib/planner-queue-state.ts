import type { PlannerControlOrder } from "../services/planner";

/**
 * What one plan-queue row says: its state badge with the reason in words, and its four
 * release gates (spec math, material/recipe, artwork, route). Built only from the row's own
 * blockers and checks, the same rules as the release checklist, so a gate is red only when
 * that gate itself fails (an artwork-only row is "Artwork pending", never "Blocked").
 */

export type GateState = "ok" | "warn" | "bad" | "skip";
export interface QueueGate { key: "spec" | "material" | "artwork" | "route"; letter: string; word: string; state: GateState; detail: string }
export type QueueTone = "done" | "wait" | "block" | "replan";
export interface QueueRowState { tone: QueueTone; label: string; why: string; more: number }

type Row = Partial<PlannerControlOrder> & Record<string, any>;

const fmt = (value: unknown, decimals = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: decimals }) : "—";
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},?\s*/gi;

/** Message text for people: database ids dropped, empty brackets tidied. */
const text = (value: unknown) => {
    const s = String(value ?? "").replace(UUID, "").replace(/\(\s*,?\s*\)/g, "").replace(/\(\s*,\s*/g, "(").trim();
    return !s || s === "-" || ["none", "null", "undefined"].includes(s.toLowerCase()) ? "" : s;
};

export function isPartialReplanRow(row: Row): boolean {
    return Boolean(row.partial_replan_required)
        || String(row.line_status || "").toUpperCase() === "PARTIAL"
        || Number(row.partial_shortfall_kg || 0) > 0;
}

function blockerCodes(row: Row): Map<string, string> {
    const codes = new Map<string, string>();
    for (const blocker of (Array.isArray(row.blockers) ? row.blockers : []) as any[]) {
        const code = String(blocker?.code || "").toUpperCase();
        if (code && !codes.has(code)) codes.set(code, text(blocker?.message));
    }
    return codes;
}

export function queueGates(row: Row): QueueGate[] {
    const codes = blockerCodes(row);
    const printOn = Boolean(row.printing_enabled ?? row.print_type);
    const artworkPending = !!row.artwork_assignment_required && !row.assigned_artwork_id;
    const bomErrors: string[] = Array.isArray(row.bom_readiness_errors) ? row.bom_readiness_errors : [];
    const lineCount = row.material_plan_summary ? Number(row.material_plan_summary.line_count || 0) : null;
    const start = Number(row.required_start_step);
    const last = Number(row.route_last_step_index);
    const routeOk = row.required_start_step != null && row.route_last_step_index != null && Number.isFinite(start) && Number.isFinite(last) && start <= last;
    const steps: Array<{ index: number; code: string }> = Array.isArray(row.queue_route_steps) ? row.queue_route_steps : [];
    const stepName = (index: number) => steps.find((step) => step.index === index)?.code || `step ${index + 1}`;
    const specBad = row.math_valid === false || codes.has("ROW_ERROR");
    const materialBad = bomErrors.length > 0 || codes.has("BOM_NOT_READY");
    const lookupFailed = codes.has("INVENTORY_LOOKUP_ERROR");
    const replan = isPartialReplanRow(row);
    return [
        {
            key: "spec", letter: "S", word: "Spec",
            state: specBad ? "bad" : "ok",
            detail: specBad ? (codes.get("ROW_ERROR") || text(row.math_error) || "Spec or quantity math is invalid") : "Spec and quantity math valid",
        },
        {
            key: "material", letter: "M", word: "Material",
            state: materialBad ? "bad" : lookupFailed || lineCount === 0 ? "warn" : lineCount === null ? "skip" : "ok",
            detail: materialBad
                ? `Recipe / BOM not ready${bomErrors[0] ? `: ${bomErrors[0]}` : ""}`
                : lookupFailed
                ? codes.get("INVENTORY_LOOKUP_ERROR") || "Stock lookup failed"
                : lineCount === 0
                ? "Material plan has no lines yet"
                : lineCount === null
                ? "Material plan is checked when the line opens"
                : `${fmt(lineCount)} material line${lineCount === 1 ? "" : "s"} ready`,
        },
        {
            key: "artwork", letter: "A", word: "Artwork",
            state: !printOn ? "skip" : artworkPending ? "warn" : "ok",
            detail: !printOn ? "No print, no artwork needed" : artworkPending ? "Assign approved artwork before release" : row.assigned_artwork_id ? "Artwork assigned" : "Artwork gate off for this master",
        },
        {
            key: "route", letter: "R", word: "Route",
            state: !routeOk || replan ? "warn" : "ok",
            detail: !routeOk
                ? "Route span not resolved"
                : replan
                ? `Balance run ${stepName(start)} → ${stepName(last)}`
                : start === last
                ? `One step: ${stepName(start)}`
                : `Runs ${stepName(start)} → ${stepName(last)}`,
        },
    ];
}

const KNOWN = new Set(["ROW_ERROR", "MATH_INVALID", "BOM_NOT_READY", "PARTIAL_SHORTFALL", "ARTWORK_REQUIRED", "INVENTORY_LOOKUP_ERROR"]);

export function queueState(row: Row): QueueRowState {
    const codes = blockerCodes(row);
    const issues: Array<Omit<QueueRowState, "more">> = [];
    if (codes.has("ROW_ERROR")) issues.push({ tone: "block", label: "Row error", why: codes.get("ROW_ERROR") || "This line could not be computed" });
    if (row.math_valid === false || codes.has("MATH_INVALID")) {
        issues.push({ tone: "block", label: "Planning required", why: text(row.math_error) || codes.get("MATH_INVALID") || "Spec or quantity math is invalid" });
    }
    if (codes.has("BOM_NOT_READY")) {
        const message = codes.get("BOM_NOT_READY") || "";
        issues.push({ tone: "block", label: "Blocked · recipe", why: message.replace(/^Recipe\/BOM is not production-ready:\s*/i, "Recipe: ") || "Recipe / BOM is not production-ready" });
    }
    if (isPartialReplanRow(row)) {
        const replanKg = Number(row.qty_replan_remaining_kg || row.partial_shortfall_kg || 0);
        const shipKg = Number(row.qty_dispatchable || 0);
        issues.push({ tone: "replan", label: "Replan", why: `${shipKg > 0 ? `Ship ${fmt(shipKg)} kg · ` : ""}replan ${fmt(replanKg, 1)} kg balance` });
    }
    if (codes.has("ARTWORK_REQUIRED") || (!!row.artwork_assignment_required && !row.assigned_artwork_id)) {
        issues.push({ tone: "wait", label: "Artwork pending", why: "Assign approved artwork to release" });
    }
    if (codes.has("INVENTORY_LOOKUP_ERROR")) issues.push({ tone: "wait", label: "Check stock", why: codes.get("INVENTORY_LOOKUP_ERROR") || "Stock lookup failed; open the line to retry" });
    for (const [code, message] of codes) {
        if (!KNOWN.has(code)) issues.push({ tone: "block", label: "Blocked", why: message || code.replace(/_/g, " ").toLowerCase() });
    }
    if (issues.length) return { ...issues[0], more: issues.length - 1 };
    const avail = (row.source_availability || {}) as Record<string, any>;
    const fg = Number(avail.fg_match_count || 1);
    const wip = Number(avail.wip_match_count || 1);
    const why = avail.has_fg
        ? `FG match · ${fmt(fg)} batch${fg === 1 ? "" : "es"} in stock`
        : avail.has_wip
        ? `WIP continue · ${fmt(wip)} roll${wip === 1 ? "" : "s"}`
        : "Fresh run";
    return { tone: "done", label: "Ready to release", why, more: 0 };
}
