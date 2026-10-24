import assert from 'node:assert/strict';
import { queueGates, queueState } from '../src/lib/planner-queue-state.ts';

const base = {
    order_kind: 'sales', order_id: 'o', math_valid: true, printing_enabled: true, print_type: 'ROTO',
    artwork_assignment_required: false, assigned_artwork_id: '', blockers: [], bom_readiness_errors: [],
    material_plan_summary: { line_count: 14 }, required_start_step: 0, route_last_step_index: 3,
    queue_route_steps: [{ index: 0, code: 'PRT' }, { index: 1, code: 'Lam' }, { index: 2, code: 'Slt' }, { index: 3, code: 'Pch' }],
    source_availability: { has_fg: false, has_wip: false },
};
const gate = (row, key) => queueGates(row).find((g) => g.key === key).state;

// Artwork is the only open item: amber "Artwork pending", material stays green (the live bug was red Blocked + red material).
const artworkOnly = { ...base, artwork_assignment_required: true,
    blockers: [{ code: 'ARTWORK_REQUIRED', message: 'Artwork assignment is required before release.' }] };
assert.equal(queueState(artworkOnly).label, 'Artwork pending');
assert.equal(queueState(artworkOnly).tone, 'wait');
assert.equal(gate(artworkOnly, 'artwork'), 'warn');
assert.equal(gate(artworkOnly, 'material'), 'ok', 'an artwork blocker must not turn the material gate red');
assert.equal(gate(artworkOnly, 'spec'), 'ok');

// Recipe not ready is red on material, and outranks artwork in the badge (artwork counted as one more).
const recipeAndArtwork = { ...artworkOnly, bom_readiness_errors: ['Layer 2 has no recipe'],
    blockers: [{ code: 'BOM_NOT_READY', message: 'Recipe/BOM is not production-ready: Layer 2 has no recipe' }, ...artworkOnly.blockers] };
assert.equal(queueState(recipeAndArtwork).label, 'Blocked · recipe');
assert.equal(queueState(recipeAndArtwork).why, 'Recipe: Layer 2 has no recipe');
assert.equal(queueState(recipeAndArtwork).more, 1);
assert.equal(gate(recipeAndArtwork, 'material'), 'bad');

// Invalid math is "Planning required" on the spec gate.
const badMath = { ...base, math_valid: false, math_error: 'Geometry pending', blockers: [{ code: 'MATH_INVALID', message: 'Geometry pending' }] };
assert.equal(queueState(badMath).label, 'Planning required');
assert.equal(gate(badMath, 'spec'), 'bad');

// Clean rows are ready, with the source in words; no print means the artwork gate is not needed.
assert.deepEqual(queueState(base), { tone: 'done', label: 'Ready to release', why: 'Fresh run', more: 0 });
assert.equal(queueState({ ...base, source_availability: { has_fg: true, fg_match_count: 2 } }).why, 'FG match · 2 batches in stock');
assert.equal(gate({ ...base, printing_enabled: false, print_type: '' }, 'artwork'), 'skip');
assert.match(queueGates(base).find((g) => g.key === 'route').detail, /PRT → Pch/);

// Partial balance is a replan, not a block.
const partial = { ...base, partial_replan_required: true, partial_shortfall_kg: 121.6, qty_dispatchable: 1158,
    blockers: [{ code: 'PARTIAL_SHORTFALL', message: 'Remaining 121.600 KG still needs planning or short-close.' }] };
assert.equal(queueState(partial).tone, 'replan');
assert.equal(gate(partial, 'route'), 'warn');
// Database ids never reach the reason text.
const noRecipe = { ...base, bom_readiness_errors: ['x'], blockers: [{ code: 'BOM_NOT_READY',
    message: 'Recipe/BOM is not production-ready: No recipe for PP-SHEET (d0e7a692-b2c1-41f2-bcd4-41e3dff88ff0, 51.0µ)' }] };
assert.equal(queueState(noRecipe).why, 'Recipe: No recipe for PP-SHEET (51.0µ)');
console.log('Plan queue state and gate rules passed.');
