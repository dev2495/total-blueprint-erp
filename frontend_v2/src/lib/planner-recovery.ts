import type { PlanOrderPayload, PlannerOrderKind, ReleaseOrderPayload } from '../services/planner';

export const PLANNER_RECOVERY_EVENT = 'planner-operation-changed';

export interface PendingPlannerOperation {
    order_kind: PlannerOrderKind;
    order_id: string;
    sales_order_item_id?: string | null;
    order_number: string;
    line_label?: string;
    plan: PlanOrderPayload;
    release: ReleaseOrderPayload;
    releaseImmediately: boolean;
    planResult?: { revision?: string; line_status?: string };
}

function key(userId: string) { return `planner-pending-v1:${userId}`; }
function browserStorage() { return typeof window === 'undefined' ? undefined : window.sessionStorage; }

export function pendingPlannerOperations(userId: string, storage?: Storage): PendingPlannerOperation[] {
    try {
        const records = JSON.parse((storage || browserStorage())?.getItem(key(userId)) || '[]');
        return Array.isArray(records) ? records.filter((row) => row?.order_id && row?.plan?.operation_id && row?.release?.operation_id) : [];
    } catch { return []; }
}

export function savePendingPlannerOperation(userId: string, operation: PendingPlannerOperation, storage?: Storage) {
    if (!userId) return;
    try {
        const records = pendingPlannerOperations(userId, storage).filter((row) => row.plan.operation_id !== operation.plan.operation_id);
        (storage || browserStorage())?.setItem(key(userId), JSON.stringify([...records, operation]));
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLANNER_RECOVERY_EVENT));
    } catch { /* In-memory recovery still works when browser storage is unavailable. */ }
}

export function removePendingPlannerOperation(userId: string, operationId: string, storage?: Storage) {
    try {
        const records = pendingPlannerOperations(userId, storage).filter((row) => row.plan.operation_id !== operationId);
        (storage || browserStorage())?.setItem(key(userId), JSON.stringify(records));
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLANNER_RECOVERY_EVENT));
    } catch { /* A storage failure must never turn a committed order into a failed order. */ }
}

export function needsPlannerRelease(operation: PendingPlannerOperation) {
    return operation.releaseImmediately && (!operation.planResult?.line_status || operation.planResult.line_status === 'PLANNED');
}
