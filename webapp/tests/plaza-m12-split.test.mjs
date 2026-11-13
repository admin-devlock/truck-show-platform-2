import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareM12Split, MAP_ID, M12_ASSIGNMENT } from '../scripts/split_plaza_m12.mjs';

function fixture() {
  const poly = {
    M12: [[32003.3, 24172.2], [23003.3, 24172.2], [23003.3, 21172.2], [32003.3, 21172.2]],
    M9: [[21280.5, 21172.2], [17280.5, 21172.2], [17280.5, 24172.2], [21280.5, 24172.2]],
    M13: [[38484.2, 24172.2], [33484.2, 24172.2], [33484.2, 21172.2], [38484.2, 21172.2]],
  };
  const booths = Object.entries(poly).map(([number, polygon]) => {
    const w = (Math.max(...polygon.map((p) => p[0])) - Math.min(...polygon.map((p) => p[0]))) / 1000;
    return { number, kind: 'built', irregular: false, polygon, width_m: w, depth_m: 3, area_m2: w * 3,
      centroid: [polygon.reduce((s, p) => s + p[0], 0) / 4, 22672.2] };
  });
  const lines = ['<g stroke="#1a56db" stroke-width="70" fill="none" stroke-linecap="round" class="booth">',
    ...booths.flatMap((b) => b.polygon.map((p, i) => { const q = b.polygon[(i + 1) % 4]; return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`; })),
    '</g>', '<g text-anchor="middle" class="labels">',
    '<text x="27503.3" y="22218.6" font-size="1260" fill="#0f3d8a" dominant-baseline="central">M12</text>',
    '<text x="27503.3" y="23377.8" font-size="756" fill="#5f6368" dominant-baseline="central">9 × 3</text>', '</g>'];
  const thumbSvg = booths.map((b) => `<polygon points="${b.polygon.map((p) => p.map(Math.round).join(',')).join(' ')}"/>`).join('\n');
  return { id: MAP_ID, document: { title: 'All Levels – Working Plans', thumbSvg, boothCount: 3 },
    render: { main: { svg: lines.join('\n'), boothsJson: JSON.stringify({ booths, count: 3, named: 3 }) }, other: { svg: 'x', boothsJson: '{"booths":[]}' } },
    levels: { main: { thumbSvg, boothCount: 3 } },
    meta: { booths: { statusTypes: [{ id: 'ni6aper', name: 'Status', statuses: [{ id: 'slzvkhj', name: 'Offer Sent', color: '#000' }] }], splits: {},
      assignments: { M12: structuredClone(M12_ASSIGNMENT), M9: { exhibitor: 'Little Spurs' }, M13: { exhibitor: 'Neighbour' } } } } };
}

test('splits M12 into M10 (3×3, beside M9) and M11 (6×3) without touching anything else', () => {
  const source = fixture(), before = structuredClone(source), next = prepareM12Split(source);
  assert.deepEqual(source, before, 'input mutated');
  const booths = JSON.parse(next.render.boothsJson).booths;
  assert.deepEqual(booths.map((b) => b.number), ['M10', 'M11', 'M9', 'M13']);
  const m10 = booths.find((b) => b.number === 'M10'), m11 = booths.find((b) => b.number === 'M11');
  assert.equal(m10.area_m2, 9); assert.equal(m10.width_m, 3); assert.equal(m11.area_m2, 18); assert.equal(m11.width_m, 6);
  assert.ok(Math.max(...m10.polygon.map((p) => p[0])) <= Math.min(...m11.polygon.map((p) => p[0])), 'M10 must be on the M9 side');
  const orig = JSON.parse(source.render.main.boothsJson).booths;
  for (const n of ['M9', 'M13']) assert.deepEqual(booths.find((b) => b.number === n), orig.find((b) => b.number === n));
  assert.equal(next.level.boothCount, 4); assert.equal(next.document.boothCount, 4);
  assert.equal(JSON.parse(next.render.boothsJson).named, 4);
  assert.ok(!next.render.svg.includes('>M12<'));
  assert.ok(next.render.svg.includes('<line x1="26003.3" y1="21172.2" x2="26003.3" y2="24172.2"/>'));
  assert.ok(next.render.svg.includes('x="24503.3" y="22218.6" font-size="1260" fill="#0f3d8a" dominant-baseline="central">M10<'));
  assert.ok(next.render.svg.includes('x="29003.3" y="23377.8" font-size="756" fill="#5f6368" dominant-baseline="central">6 × 3<'));
  assert.ok(next.level.thumbSvg.includes('26003,24172 23003,24172 23003,21172 26003,21172'));
  const expected = structuredClone(source.meta.booths); delete expected.assignments.M12;
  expected.assignments.M10 = { exhibitor: 'Loaded Threads', statusIdsByType: { ni6aper: 'slzvkhj' }, labelMode: 'dims' };
  expected.assignments.M11 = { exhibitor: 'NXT', statusIdsByType: { ni6aper: 'slzvkhj' }, labelMode: 'dims' };
  assert.deepEqual(next.meta, expected);
});

test('refuses when M12 booking, geometry, or target numbers have changed', () => {
  let s = fixture(); s.meta.booths.assignments.M12.exhibitor = 'Someone else';
  assert.throws(() => prepareM12Split(s), /booking changed/);
  s = fixture(); s.meta.booths.assignments.M10 = { exhibitor: 'Taken' };
  assert.throws(() => prepareM12Split(s), /M10 already has/);
  s = fixture(); const d = JSON.parse(s.render.main.boothsJson); d.booths[0].polygon[0][0] += 1; s.render.main.boothsJson = JSON.stringify(d);
  assert.throws(() => prepareM12Split(s), /geometry changed/);
  s = fixture(); s.render.other.boothsJson = JSON.stringify({ booths: [{ number: 'M11' }] });
  assert.throws(() => prepareM12Split(s), /M11 already exists/);
  s = fixture(); s.meta.booths.splits.M12 = { parts: [] };
  assert.throws(() => prepareM12Split(s), /already split/);
});
