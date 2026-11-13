// Read-only comparison of complete before/after Firestore exports for the M12 split.
// node scripts/verify_m12_split.mjs BEFORE_BACKUP_DIR AFTER_BACKUP_DIR
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareM12Split, MAP_ID, LEVEL_ID, stable } from './split_plaza_m12.mjs';
const [beforeDir, afterDir] = process.argv.slice(2).map((p) => resolve(p));
assert.ok(beforeDir && afterDir, 'Supply before and after backup directories');
async function load(dir) {
  const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
  const maps = {};
  for (const e of manifest.maps) {
    const bytes = await readFile(resolve(dir, e.filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), e.sha256);
    maps[e.id] = JSON.parse(bytes);
  }
  return maps;
}
const before = await load(beforeDir), after = await load(afterDir);
assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort(), 'Map set changed');
for (const [id, old] of Object.entries(before)) {
  const expected = structuredClone(old), actual = structuredClone(after[id]);
  if (id === MAP_ID) {
    const planned = prepareM12Split(old);
    expected.render[LEVEL_ID] = planned.render; expected.levels[LEVEL_ID] = planned.level; expected.meta.booths = planned.meta;
    Object.assign(expected.document, planned.document);
    // Intentional update timestamp; viewing/searching affects only transient UI state.
    delete expected.document.updatedAt; delete actual.document.updatedAt;
    delete expected.meta.search; delete actual.meta.search;
  }
  for (const key of ['document', 'levels', 'render', 'meta']) assert.ok(stable(expected[key]) === stable(actual[key]), `Unexpected difference: ${id}/${key}`);
}
const result = { verifiedAt: new Date().toISOString(), beforeDir, afterDir, mapsVerified: Object.keys(before).length,
  otherMapsUnchanged: true, allOtherLevelsUnchanged: true, allRetainedAssignmentsUnchanged: true, statusDefinitionsAndSplitsUnchanged: true,
  expectedChanges: ['M12 (9×3) replaced by M10 (3×3) and M11 (6×3)', 'M12 booking moved to M10 Loaded Threads / M11 NXT',
    'Plaza + map card thumbnail and booth count', 'Map update timestamp'],
  excludedTransientFields: ['presence', 'working map shared search state'] };
await writeFile(resolve(afterDir, 'm12-cross-map-verification.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
