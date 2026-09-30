"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button, Card } from '@/components/_planner-ui';
import { useToast } from '@/hooks/use-toast';
import { describeApiError } from '@/lib/api';
import { needsPlannerRelease, pendingPlannerOperations, PLANNER_RECOVERY_EVENT, removePendingPlannerOperation,
    savePendingPlannerOperation, type PendingPlannerOperation } from '@/lib/planner-recovery';
import { plannerService } from '@/services/planner';
import type { PlannerIdentity } from '@/lib/query-contract';

export function PendingPlannerRecovery({ onCommitted }: { onCommitted: (order: PlannerIdentity) => Promise<void> }) {
    const { user } = useAuth();
    const { toast } = useToast();
    const [pending, setPending] = useState<PendingPlannerOperation[]>([]);
    const [busy, setBusy] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        const refresh = () => setPending(user ? pendingPlannerOperations(user.id) : []);
        refresh();
        window.addEventListener(PLANNER_RECOVERY_EVENT, refresh);
        return () => window.removeEventListener(PLANNER_RECOVERY_EVENT, refresh);
    }, [user?.id]);

    async function resume(operation: PendingPlannerOperation) {
        if (!user || busy) return;
        const id = operation.plan.operation_id!;
        setBusy(id);
        setErrors((current) => ({ ...current, [id]: '' }));
        try {
            const result = operation.planResult || await plannerService.planOrder(operation.order_kind, operation.order_id, operation.plan);
            operation = { ...operation, planResult: result,
                release: { ...operation.release, expected_revision: result.revision } };
            savePendingPlannerOperation(user.id, operation);
            const released = needsPlannerRelease(operation);
            if (released) await plannerService.releasePlannedOrder(operation.order_kind, operation.order_id, operation.release);
            removePendingPlannerOperation(user.id, id);
            toast({ title: released ? 'Order released' : 'Plan confirmed', description: operation.order_number });
            try { await onCommitted(operation); }
            catch { toast({ title: 'Saved; queue refresh pending', description: 'Use Refresh to load the latest queue.' }); }
        } catch (error) {
            setErrors((current) => ({ ...current, [id]: describeApiError(error, 'Could not confirm the operation. Resume again when the connection returns.') }));
        } finally { setBusy(''); }
    }

    if (!pending.length) return null;
    return <Card role="status">
        <p>An earlier plan needs confirmation. Resume checks its saved result and completes the requested release.</p>
        {pending.map((operation) => <div key={operation.plan.operation_id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 12 }}>
            <strong>{operation.order_number}{operation.line_label && ` · ${operation.line_label}`}</strong>
            <Button disabled={Boolean(busy)} onClick={() => void resume(operation)}>{busy === operation.plan.operation_id ? 'Confirming…' : 'Resume'}</Button>
            {errors[operation.plan.operation_id!] && <span role="alert">{errors[operation.plan.operation_id!]}</span>}
        </div>)}
    </Card>;
}
