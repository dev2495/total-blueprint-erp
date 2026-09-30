import assert from 'node:assert/strict';
import { matchingPlannerDetail, samePlannerEntity, shouldRetryRead, isCancelledRead } from '../src/lib/query-contract.ts';
import { needsPlannerRelease, pendingPlannerOperations, savePendingPlannerOperation, removePendingPlannerOperation } from '../src/lib/planner-recovery.ts';

const first = { order_kind: 'sales', order_id: 'order', sales_order_item_id: 'line-a', revision: 'one' };
const second = { ...first, sales_order_item_id: 'line-b' };
assert.equal(matchingPlannerDetail(second, first), null, 'Previous line detail must never authorize the new line');
assert.equal(matchingPlannerDetail(first, { ...first, revision: 'old' }), null, 'Old revisions must pause actions');
assert.equal(matchingPlannerDetail(first, first), first);
assert.equal(samePlannerEntity(first, { ...first, order_kind: 'stock' }), false);
assert.equal(isCancelledRead({ code: 'ERR_CANCELED' }), true);
assert.equal(shouldRetryRead(0, { code: 'ECONNABORTED' }), false, 'Do not multiply a timed-out request');
assert.equal(shouldRetryRead(0, { code: 'ERR_CANCELED' }), false);
assert.equal(shouldRetryRead(0, { response: { status: 409 } }), false);
assert.equal(shouldRetryRead(0, { response: { status: 503, data: { code: 'READ_TIMEOUT' } } }), false);
assert.equal(shouldRetryRead(0, { response: { status: 503 } }), true);
assert.equal(shouldRetryRead(1, { response: { status: 503 } }), false);
const values = new Map();
const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
const pending = { ...first, order_number: 'SO-recovery', plan: { operation_id: 'plan-once', option: 'FRESH' },
    release: { operation_id: 'release-once' }, releaseImmediately: true };
savePendingPlannerOperation('operator-a', pending, storage);
assert.deepEqual(pendingPlannerOperations('operator-a', storage), [pending], 'Recovery survives recreating the page');
assert.deepEqual(pendingPlannerOperations('operator-b', storage), [], 'Recovery is isolated to the signed-in operator');
assert.equal(needsPlannerRelease(pending), true);
assert.equal(needsPlannerRelease({ ...pending, planResult: { line_status: 'PACKING_READY' } }), false);
removePendingPlannerOperation('operator-a', 'plan-once', storage);
assert.deepEqual(pendingPlannerOperations('operator-a', storage), []);
console.log('Query identity, revision, cancellation and retry contracts passed.');
