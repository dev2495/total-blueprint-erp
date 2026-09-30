/** Cancellation and deadlines are terminal for automatic retries. */
export function isCancelledRead(error: unknown): boolean {
    const value = error as { code?: string; name?: string } | undefined;
    return value?.code === "ERR_CANCELED" || value?.name === "AbortError" || value?.name === "CancelledError";
}

export function shouldRetryRead(failureCount: number, error: unknown): boolean {
    const value = error as { code?: string; response?: { status?: number; data?: { code?: string } } } | undefined;
    if (isCancelledRead(error) || ["ECONNABORTED", "ETIMEDOUT"].includes(value?.code || "")) return false;
    if (["READ_TIMEOUT", "READ_BUSY"].includes(value?.response?.data?.code || "")) return false;
    const status = value?.response?.status;
    if (status && status < 500) return false;
    return failureCount < 1;
}

export type PlannerIdentity = { order_kind: string; order_id: string; sales_order_item_id?: string | null; revision?: string | null };

export function samePlannerEntity(left?: PlannerIdentity | null, right?: PlannerIdentity | null): boolean {
    return Boolean(left && right && left.order_kind === right.order_kind && left.order_id === right.order_id
        && String(left.sales_order_item_id || "") === String(right.sales_order_item_id || ""));
}

export function matchingPlannerDetail<T extends PlannerIdentity>(selected: T | null, detail?: T | null): T | null {
    if (!samePlannerEntity(selected, detail)) return null;
    if (selected?.revision && detail?.revision && selected.revision !== detail.revision) return null;
    return detail || null;
}
