#!/usr/bin/env node

// Offline evaluator for position-based remapping. It never connects to Firebase or
// writes map data; both inputs are local JSON artifacts.

import { readFile } from "node:fs/promises";
import { matchBoothsByPosition, transferNumberedData } from "../src/lib/remap.ts";

if (process.argv.length !== 5) {
  console.error("usage: node scripts/analyze_remap.mjs <raw-backup.json> <old-level-id> <new-booths.json>");
  process.exit(2);
}

const [, , backupPath, oldLevelId, newPath] = process.argv;
const backup = JSON.parse(await readFile(backupPath, "utf8"));
const render = backup.render?.[oldLevelId];
if (!render?.boothsJson) throw new Error(`Backup has no booth render for level ${oldLevelId}`);
const oldBooths = JSON.parse(render.boothsJson).booths;
const newBooths = JSON.parse(await readFile(newPath, "utf8")).booths;
const result = matchBoothsByPosition(oldBooths, newBooths);
const assignments = backup.meta?.booths?.assignments || {};
const transfer = transferNumberedData(
  assignments,
  oldBooths.flatMap((booth) => booth.number ? [booth.number] : []),
  result,
);

const destinations = new Map();
for (const [from, to] of Object.entries(result.mapping)) {
  const sources = destinations.get(to) || [];
  sources.push(from);
  destinations.set(to, sources);
}
const collisions = [...destinations.entries()]
  .filter(([, from]) => from.length > 1)
  .map(([to, from]) => ({ to, from }));

console.log(JSON.stringify({
  oldRecords: oldBooths.length,
  oldNamed: oldBooths.filter((booth) => booth.number).length,
  newRecords: newBooths.length,
  newNamed: newBooths.filter((booth) => booth.number).length,
  ...result,
  transfer: {
    sourceWithData: transfer.sourceWithData,
    transferredSources: transfer.transferredSources,
    populatedDestinations: transfer.populatedDestinations,
    conflicts: transfer.conflicts,
  },
  collisions,
}, null, 2));
