import assert from 'node:assert/strict';
import { inches, inchesText, isAutoSizeName, mmWithInches, standardSizeName, withInches } from '../src/lib/size-naming.ts';

// Inches are worked out from mm, 1 decimal, no trailing zero.
assert.equal(inches(305), '12');
assert.equal(inches(140), '5.5');
assert.equal(inchesText(140, 305), '5.5 × 12 in');
assert.equal(inchesText(655), '25.8 in');
assert.equal(inchesText(0), '');
assert.equal(mmWithInches(232.5, 305), '232.5 × 305 mm · 9.2 × 12 in');
assert.equal(mmWithInches(500), '500 mm · 19.7 in');
assert.equal(withInches('140 x 305 mm'), '140 x 305 mm · 5.5 × 12 in');
assert.equal(withInches('537 mm roll · Open web'), '537 mm roll · 21.1 in · Open web');
assert.equal(withInches('655mm web'), '655mm web · 25.8 in');
assert.equal(withInches('140 x 305 mm · 5.5 × 12 in'), '140 x 305 mm · 5.5 × 12 in', 'never twice');
assert.equal(withInches('680MMX60MIC'), '680MMX60MIC', 'labels without a mm size are left alone');

// New sizes are named from their dimensions.
assert.deepEqual(standardSizeName({ width_mm: 500, thickness_micron: 45 }, true), { code: '500X45', label: '500 mm web · 45 µ' });
assert.deepEqual(standardSizeName({ width_mm: 680 }, true), { code: '680', label: '680 mm web' });
assert.deepEqual(standardSizeName({ width_mm: 140, height_mm: 305, gusset_mm: 40 }, false), { code: '140X305G40', label: '140 × 305 mm + 40 G' });
assert.deepEqual(standardSizeName({ width_mm: 232.5, height_mm: 305 }, false), { code: '232.5X305', label: '232.5 × 305 mm' });
assert.equal(standardSizeName({ width_mm: 140 }, false), null, 'a pouch needs width and height');

// Auto names follow the size until someone types their own.
const before = standardSizeName({ width_mm: 140, height_mm: 305 }, false);
assert.equal(isAutoSizeName('', 'code', before), true);
assert.equal(isAutoSizeName('SZ-12', 'code', before), true);
assert.equal(isAutoSizeName('140X305', 'code', before), true);
assert.equal(isAutoSizeName('A4-POUCH', 'code', before), false);
console.log('Size naming and inch rules passed.');
