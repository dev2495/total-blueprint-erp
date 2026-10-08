import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

// Execute the actual page handlers with deferred service responses, without
// a browser or backend mutation. AST extraction keeps this behavioral test
// coupled to the code used by both release buttons.
const pageUrl = new URL('../src/app/(dashboard)/production/work-center/[id]/page.tsx', import.meta.url);
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'e6d81bec02a8ab7e1c7de2f073330f5661d10622:frontend_v2/src/app/(dashboard)/production/work-center/[id]/page.tsx'], { encoding: 'utf8' })
  : fs.readFileSync(pageUrl, 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['updateMaterialIssueDraft', 'handleAssignAndMaybeRelease', 'handlePushToOperator']);
const statements = [];
function visit(node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(
    declaration => ts.isIdentifier(declaration.name) && names.has(declaration.name.text),
  )) statements.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(statements.length, names.size);
const executable = ts.transpileModule(statements.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness({ ready, canRelease = true, assign } = {}) {
  const state = { dirty: true, pickerOpen: true, drafts: {}, clearCalls: 0, invalidated: [], operation: null };
  const sandbox = {
    activeAssignment: { id: 'assignment-1', production_job: 'job-1', assigned_machine: 'machine-1' },
    selectedJobId: 'job-1', selectedMachineId: 'machine-1', currentStepIssueOk: true,
    currentStepIssueBlocker: '', selectedMachineUnavailable: false, pushBlockingReasons: [],
    isReleasedToMachine: false, canPushToOperator: canRelease, satisfactionStatus: { input_form: 'GRANULE' },
    rollsMissingPool: 0, materialIssuePayload: [{ requirement_id: 'requirement-1', actual_issued_qty: 11 }],
    materialIssueDraftVersionRef: { current: 1 }, hydratedMaterialJobRef: { current: 'job-1' }, wcId: 'wc-1',
    setMaterialIssueDirty(value) { state.dirty = value; if (!value) state.clearCalls += 1; },
    setMaterialIssuePickerOpen(value) { state.pickerOpen = value; },
    setMaterialIssueDrafts(update) { state.drafts = update(state.drafts); },
    setActiveAssignmentId(value) { state.assignment = value; },
    setSelectedMachineId(value) { state.machine = value; }, setAssignConflict() {}, toast() {},
    mutation: { mutate(operation) { state.operation = operation(); } },
    wcmService: {
      async markReady(id, payload) { state.saved = { id, payload }; return ready ? ready() : { id, assigned_machine: 'machine-1' }; },
      async assignMachine(id, machine) { return assign ? assign(id, machine) : { assigned_machine: machine }; },
      async autoSatisfy() {},
    },
    async refetchContext() { state.refetched = true; }, async refetchSatisfaction() {},
    queryClient: { invalidateQueries(query) { state.invalidated.push(query.queryKey); } },
  };
  const handlers = vm.runInNewContext(`${executable}\n({ updateMaterialIssueDraft, handleAssignAndMaybeRelease, handlePushToOperator })`, sandbox);
  return { state, sandbox, handlers };
}

for (const releaseHandler of ['handleAssignAndMaybeRelease', 'handlePushToOperator']) {
  const success = harness();
  success.handlers[releaseHandler]();
  await success.state.operation;
  assert.equal(success.state.dirty, false, `${releaseHandler}: persisted issue must resume polling`);
  assert.equal(success.state.pickerOpen, false);
  assert.equal(success.state.clearCalls, 1);
  assert.equal(success.state.saved.payload[0].actual_issued_qty, 11);

  const failed = harness({ ready: async () => { throw new Error('Issue rejected'); } });
  failed.handlers[releaseHandler]();
  await assert.rejects(failed.state.operation, /Issue rejected/);
  assert.equal(failed.state.dirty, true, `${releaseHandler}: failed request must protect the draft`);
  assert.equal(failed.state.clearCalls, 0);

  let resolveReady;
  const pending = harness({ ready: () => new Promise(resolve => { resolveReady = resolve; }) });
  pending.handlers[releaseHandler]();
  pending.handlers.updateMaterialIssueDraft('requirement-1', { actual_issued_qty: '12' });
  resolveReady({ id: 'assignment-1' });
  await pending.state.operation;
  assert.equal(pending.state.dirty, true, `${releaseHandler}: newer unsaved edits must survive earlier success`);
  assert.equal(pending.state.drafts['requirement-1'].actual_issued_qty, '12');

  let resolveSwitched;
  const switched = harness({ ready: () => new Promise(resolve => { resolveSwitched = resolve; }) });
  switched.handlers[releaseHandler]();
  switched.sandbox.hydratedMaterialJobRef.current = 'job-2';
  resolveSwitched({ id: 'assignment-1' });
  await switched.state.operation;
  assert.equal(switched.state.dirty, true, `${releaseHandler}: another selected job cannot be acknowledged by this request`);
}

const assignedOnly = harness({ canRelease: false });
assignedOnly.handlers.handleAssignAndMaybeRelease();
await assignedOnly.state.operation;
assert.equal(assignedOnly.state.dirty, true, 'Machine-only assignment does not persist the issue draft');
assert.equal(assignedOnly.state.saved, undefined);

const machineConflict = harness({ assign: async () => { throw new Error('Machine busy'); } });
machineConflict.sandbox.activeAssignment.assigned_machine = null;
machineConflict.handlers.handleAssignAndMaybeRelease();
await assert.rejects(machineConflict.state.operation, /Machine busy/);
assert.equal(machineConflict.state.dirty, true);
assert.equal(machineConflict.state.saved, undefined);
console.log('WCM release draft persistence, errors, concurrent edits and job switches passed.');
