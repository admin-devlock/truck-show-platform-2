#!/usr/bin/env node
// Client-requested Plaza merch change (Nov 2026): split booth M12 (9 m × 3 m) into
//   M10 = 3 m × 3 m (the end beside M9) and M11 = 6 m × 3 m. M12 no longer exists.
// Same guarded process as correct_merch_booths.mjs / adjust_october_stands.mjs:
// verified backup in, preview by default, one transaction that aborts if anything
// changed since the backup, append-only audit event, post-write re-read.
// Scope: the live "All Levels – Working Plans" map only (older BCEC copies were not
// carried forward by earlier merch fixes either).
// Needs Node ≥ 23.6, or on Node 22: export NODE_OPTIONS="--experimental-strip-types"
// node --env-file=.env.local scripts/split_plaza_m12.mjs BACKUP_DIR [--apply]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, collection, getDocsFromServer, runTransaction, getDocFromServer, serverTimestamp, terminate } from 'firebase/firestore';
import { polygonIntersectionArea } from '../src/lib/remap.ts';

export const MAP_ID = 'xDUYA9nxn7ThMmYcJXhZ', LEVEL_ID = 'main';
const operationId = 'split-M12-into-M10-M11-2026-11-13';
const sha = (value) => createHash('sha256').update(value).digest('hex');
export const stable = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const same = (a, b) => stable(a) === stable(b);
const area = (poly) => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2 / 1e6;
const points = (poly) => poly.map((p) => p.map(Math.round).join(',')).join(' ');

// Geometry as it stands in the 2026-11-13 backup. M9 sits to the left (lower x), so
// the 3 m booth M10 takes the left end and the divider lands 3 m in from x=23003.3.
const M12_POLY = [[32003.3, 24172.2], [23003.3, 24172.2], [23003.3, 21172.2], [32003.3, 21172.2]];
const M9_POLY = [[21280.5, 21172.2], [17280.5, 21172.2], [17280.5, 24172.2], [21280.5, 24172.2]];
const LEFT = 23003.3, RIGHT = 32003.3, DIVIDER = 26003.3, TOP = 21172.2, BOTTOM = 24172.2;
// M12 was already booked against both future booths; status is shared.
export const M12_ASSIGNMENT = { exhibitor: 'M10 Loaded Threads / M11 NXT', statusIdsByType: { ni6aper: 'slzvkhj' }, labelMode: 'dims' };
export const NEW_ASSIGNMENTS = {
  M10: { exhibitor: 'Loaded Threads', statusIdsByType: { ni6aper: 'slzvkhj' }, labelMode: 'dims' },
  M11: { exhibitor: 'NXT', statusIdsByType: { ni6aper: 'slzvkhj' }, labelMode: 'dims' },
};

export function prepareM12Split(backup) {
  assert.equal(backup.id, MAP_ID); assert.equal(backup.document.title, 'All Levels – Working Plans');
  const original = backup.render[LEVEL_ID], meta = backup.meta.booths, data = JSON.parse(original.boothsJson);
  const everywhere = Object.values(backup.render).flatMap((r) => JSON.parse(r.boothsJson).booths);
  assert.equal(everywhere.filter((b) => b.number === 'M12').length, 1, 'Expected exactly one M12');
  for (const n of ['M10', 'M11']) {
    assert.ok(!everywhere.some((b) => b.number === n), `${n} already exists on this map`);
    assert.ok(!meta.assignments[n], `${n} already has an assignment`);
  }
  for (const [n, s] of Object.entries(meta.splits || {})) {
    assert.ok(!['M10', 'M11', 'M12'].includes(n) && !s.parts.some((p) => ['M10', 'M11', 'M12'].includes(p.number)), 'Target is already split');
  }
  const m12 = data.booths.find((b) => b.number === 'M12'), m9 = data.booths.find((b) => b.number === 'M9');
  assert.deepEqual(m12.polygon, M12_POLY, 'M12 geometry changed since planning');
  assert.deepEqual(m9.polygon, M9_POLY, 'M9 geometry changed since planning');
  assert.ok(!m12.irregular && !m12.absorbed && m12.width_m === 9 && m12.depth_m === 3 && m12.area_m2 === 27);
  assert.ok(same(meta.assignments.M12, M12_ASSIGNMENT), 'M12 booking changed since planning; confirm the M10/M11 assignment again');

  const part = (number, from, to) => ({ ...m12, number, width_m: (to - from) / 1000, depth_m: 3, area_m2: (to - from) * 3 / 1000,
    centroid: [Math.round((from + to) * 5) / 10, 22672.2],
    polygon: [[to, BOTTOM], [from, BOTTOM], [from, TOP], [to, TOP]] });
  const changed = { M10: part('M10', LEFT, DIVIDER), M11: part('M11', DIVIDER, RIGHT) };
  assert.deepEqual(changed.M10.centroid, [24503.3, 22672.2]); assert.deepEqual(changed.M11.centroid, [29003.3, 22672.2]);
  for (const b of Object.values(changed)) assert.ok(Math.abs(area(b.polygon) - b.area_m2) < 1e-6, `${b.number} area mismatch`);
  assert.equal(changed.M10.area_m2, 9); assert.equal(changed.M11.area_m2, 18);
  assert.ok(Math.abs(area(changed.M10.polygon) + area(changed.M11.polygon) - area(m12.polygon)) < 1e-6, 'Total area changed');
  assert.equal(polygonIntersectionArea(changed.M10.polygon, changed.M11.polygon), 0);
  const booths = data.booths.flatMap((b) => (b === m12 ? [changed.M10, changed.M11] : [b]));
  assert.equal(booths.length, data.booths.length + 1);
  for (const b of data.booths.filter((b) => b !== m12 && b.polygon?.length)) {
    assert.ok(booths.includes(b), 'Unrelated booth changed');
    const before = polygonIntersectionArea(m12.polygon, b.polygon);
    const after = polygonIntersectionArea(changed.M10.polygon, b.polygon) + polygonIntersectionArea(changed.M11.polygon, b.polygon);
    assert.ok(Math.abs(before - after) < 0.1, `Neighbour overlap changed: ${b.number}`);
  }

  // Drawing: add the M10/M11 divider in the booth group right after M12's right edge;
  // swap the baked "M12 / 9 × 3" labels for the converter-sized labels of each part.
  // (The viewer and exports draw their own labels from booth data; this keeps the raw
  // SVG consistent for anything that shows it unmodified.)
  let group = null, edges = 0, dividers = 0, labelEdits = 0;
  const svg = original.svg.split('\n').flatMap((line) => {
    const g = line.match(/^<g [^>]*class="([^"]+)"/); if (g) group = g[1];
    if (line.startsWith('<line ')) {
      const a = Object.fromEntries([...line.matchAll(/(x1|x2|y1|y2)="([^"]+)"/g)].map((m) => [m[1], Number(m[2])]));
      if (a.x1 === DIVIDER && a.x2 === DIVIDER) dividers++;
      if (group === 'booth' && a.x1 === RIGHT && a.x2 === RIGHT && Math.min(a.y1, a.y2) === TOP && Math.max(a.y1, a.y2) === BOTTOM) {
        edges++;
        return [line, `<line x1="${DIVIDER}" y1="${TOP}" x2="${DIVIDER}" y2="${BOTTOM}"/>`];
      }
    }
    if (line.startsWith('<text ') && line.includes('x="27503.3"')) {
      if (/y="22218\.6".*>M12</.test(line)) {
        labelEdits++;
        return ['M10', 'M11'].map((n) => line.replace('x="27503.3"', `x="${changed[n].centroid[0]}"`).replace('>M12<', `>${n}<`));
      }
      if (/y="23377\.8".*>9 × 3</.test(line)) {
        labelEdits++;
        return ['M10', 'M11'].map((n) => line.replace('x="27503.3"', `x="${changed[n].centroid[0]}"`).replace('>9 × 3<', `>${changed[n].width_m} × 3<`));
      }
    }
    return [line];
  }).join('\n');
  assert.equal(dividers, 0, 'A line already exists on the divider'); assert.equal(edges, 1); assert.equal(labelEdits, 2);
  assert.ok(!/>M12</.test(svg)); assert.ok(svg.includes('>M10<') && svg.includes('>M11<') && svg.includes('>6 × 3<'));

  let thumbEdits = 0;
  const thumb = backup.levels[LEVEL_ID].thumbSvg.replace(/<polygon points="([^"]+)"\/>/g, (tag, p) => {
    if (p !== points(m12.polygon)) return tag;
    thumbEdits++;
    return `<polygon points="${points(changed.M10.polygon)}"/><polygon points="${points(changed.M11.polygon)}"/>`;
  });
  assert.equal(thumbEdits, 1);
  assert.equal(backup.document.thumbSvg, backup.levels[LEVEL_ID].thumbSvg, 'Map card thumbnail no longer mirrors Plaza');
  assert.equal(backup.document.boothCount, backup.levels[LEVEL_ID].boothCount);

  const assignments = { ...meta.assignments, ...NEW_ASSIGNMENTS }; delete assignments.M12;
  for (const [n, a] of Object.entries(meta.assignments)) if (n !== 'M12') assert.ok(same(assignments[n], a), `Assignment changed for ${n}`);
  const nextMeta = { ...meta, assignments };
  const nextData = { ...data, booths, count: data.count + 1, named: data.named + 1 };
  const render = { ...original, svg, boothsJson: JSON.stringify(nextData) };
  const level = { ...backup.levels[LEVEL_ID], thumbSvg: thumb, boothCount: nextData.count };
  const report = { mapId: MAP_ID, levelId: LEVEL_ID, before: { M12: m12 }, after: changed,
    assignments: { removed: { M12: meta.assignments.M12 }, added: NEW_ASSIGNMENTS },
    boothCount: { before: data.count, after: nextData.count }, svgEdits: { dividerAdded: 1, labelEdits }, thumbEdits,
    unchangedOtherBooths: data.booths.length - 1, unchangedAssignments: Object.keys(meta.assignments).length - 1 };
  return { render, level, document: { thumbSvg: thumb, boothCount: nextData.count }, meta: nextMeta, report };
}

async function main() {
  assert.ok(process.argv[2], 'Supply verified backup directory');
  assert.ok(process.argv.slice(3).every((a) => a === '--apply'), 'Unknown argument');
  const dir = resolve(process.argv[2]), apply = process.argv.includes('--apply');
  const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectId, 'truckshow-platform');
  for (const e of manifest.maps) assert.equal(sha(await readFile(resolve(dir, e.filename))), e.sha256, 'Backup checksum failed');
  const entry = manifest.maps.find((m) => m.id === MAP_ID); assert.ok(entry);
  const backup = JSON.parse(await readFile(resolve(dir, entry.filename), 'utf8'));
  const next = prepareM12Split(backup);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', ...next.report }, null, 2));
  if (!apply) {
    await writeFile(resolve(dir, 'm12-split-plan.json'), JSON.stringify(next.report, null, 2), { flag: 'wx' });
    await writeFile(resolve(dir, 'm12-split-preview.svg'), next.render.svg.replace(/viewBox="[^"]+"/, 'viewBox="11000 16000 25000 12000"'), { flag: 'wx' });
    return;
  }
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, manifest.projectId);
  const app = initializeApp({ apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, projectId: manifest.projectId, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN });
  const db = getFirestore(app);
  try {
    const { user } = await signInAnonymously(getAuth(app));
    // The viewer tracks the open booth by list index; inserting M10/M11 shifts later
    // Plaza booths by one, so an open booth panel could jump to a neighbour. Only apply
    // while nobody has the map open (presence heartbeats every ~15s; 2 min = clearly gone).
    const present = (await getDocsFromServer(collection(db, 'maps', MAP_ID, 'presence'))).docs
      .map((d) => d.data()).filter((p) => p.lastActive && Date.now() - p.lastActive.toMillis() < 120_000);
    assert.equal(present.length, 0, `Map is open by: ${present.map((p) => p.name).join(', ')}. Wait until they have closed it, then re-run.`);
    const mapRef = doc(db, 'maps', MAP_ID), renderRef = doc(db, 'maps', MAP_ID, 'render', LEVEL_ID), levelRef = doc(db, 'maps', MAP_ID, 'levels', LEVEL_ID),
      metaRef = doc(db, 'maps', MAP_ID, 'meta', 'booths'), auditRef = doc(db, 'activity', operationId);
    await runTransaction(db, async (tx) => {
      const [m, r, l, b, a] = await Promise.all([mapRef, renderRef, levelRef, metaRef, auditRef].map((ref) => tx.get(ref)));
      assert.ok(!a.exists(), 'Already applied; do not rerun'); assert.equal(m.data()?.title, backup.document.title);
      assert.ok(same(r.data(), backup.render[LEVEL_ID]), 'Render changed since backup; refresh backup');
      assert.equal(l.data().thumbSvg, backup.levels[LEVEL_ID].thumbSvg); assert.equal(l.data().boothCount, backup.levels[LEVEL_ID].boothCount);
      assert.equal(m.data().thumbSvg, backup.document.thumbSvg); assert.equal(m.data().boothCount, backup.document.boothCount);
      assert.ok(same(b.data(), backup.meta.booths), 'Assignments changed since backup; refresh backup');
      tx.update(renderRef, { svg: next.render.svg, boothsJson: next.render.boothsJson });
      tx.update(levelRef, { thumbSvg: next.level.thumbSvg, boothCount: next.level.boothCount });
      tx.update(metaRef, { assignments: next.meta.assignments });
      tx.update(mapRef, { thumbSvg: next.document.thumbSvg, boothCount: next.document.boothCount, updatedAt: serverTimestamp() });
      tx.set(auditRef, { schemaVersion: 2, authUid: user.uid, actor: { uid: user.uid, name: 'Devlock — authorized booth split', isGuest: true },
        eventType: 'mutation', action: 'Split booth M12 into M10 and M11', mapId: MAP_ID, path: `/map/${MAP_ID}`, clientAt: Date.now(), createdAt: serverTimestamp(),
        metadata: { backupSha256: entry.sha256, operationId, before: JSON.stringify(next.report.before), after: JSON.stringify(next.report.after),
          removedAssignment: JSON.stringify(next.report.assignments.removed), addedAssignments: JSON.stringify(NEW_ASSIGNMENTS) } });
    });
    const [r, b, l, m, a] = await Promise.all([renderRef, metaRef, levelRef, mapRef, auditRef].map((ref) => getDocFromServer(ref)));
    assert.ok(same(r.data(), next.render), 'Post-write render mismatch'); assert.ok(same(b.data(), next.meta), 'Post-write metadata mismatch');
    assert.equal(l.data().thumbSvg, next.level.thumbSvg); assert.equal(l.data().boothCount, next.level.boothCount);
    assert.equal(m.data().thumbSvg, next.document.thumbSvg); assert.equal(m.data().boothCount, next.document.boothCount); assert.ok(a.exists());
    await writeFile(resolve(dir, 'm12-split-receipt.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), backupSha256: entry.sha256,
      renderSha256: sha(stable(r.data())), metaSha256: sha(stable(b.data())), ...next.report }, null, 2), { flag: 'wx' });
    console.log('APPLIED AND VERIFIED. Only M12 → M10/M11 geometry, labels, thumbnails, counts and the M12 booking changed.');
  } finally { await terminate(db); await deleteApp(app); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
