#!/usr/bin/env node
// Authorized one-map migration. Preview by default; requires a verified backup.
// node --env-file=.env.local scripts/merge_workflow_statuses.mjs BACKUP_DIR [--apply]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, doc, getDocFromServer, runTransaction, serverTimestamp, terminate } from "firebase/firestore";
import { statusIdForType } from "../src/lib/statuses.ts";

const mapId = "xDUYA9nxn7ThMmYcJXhZ";
const operationId = "merge-offers-compliance-2026-09-23";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
const same = (a, b) => stable(a) === stable(b);

export function mergeWorkflowStatuses(meta) {
  assert.equal(meta.statusTypes.length, 2, "Expected exactly Offers and Compliance");
  const offers = meta.statusTypes.find(type => type.id === "ni6aper" && type.name === "Offers");
  const compliance = meta.statusTypes.find(type => type.id === "sc" && type.name === "Compliance");
  assert.ok(offers && compliance, "Unexpected status categories; inspect before migrating");
  const statuses = [...offers.statuses, ...compliance.statuses];
  assert.equal(new Set(statuses.map(status => status.id)).size, statuses.length, "Duplicate status IDs");
  const mergedType = { ...offers, name: "Status", statuses };
  const counts = Object.fromEntries(statuses.map(status => [status.id, 0]));
  let withoutStatus = 0;
  const assignments = Object.fromEntries(Object.entries(meta.assignments).map(([number, assignment]) => {
    // Reject dangling references instead of silently dropping potentially useful data.
    for (const [typeId, statusId] of Object.entries(assignment.statusIdsByType || {})) {
      if (statusId == null) continue;
      const type = meta.statusTypes.find(item => item.id === typeId);
      assert.ok(type?.statuses.some(status => status.id === statusId), `Unknown status reference on booth ${number}`);
    }
    if (assignment.statusId) {
      assert.ok(statuses.some(status => status.id === assignment.statusId), `Unknown legacy status on booth ${number}`);
    }
    const previousIds = meta.statusTypes.map(type => statusIdForType(assignment, type)).filter(Boolean);
    assert.ok(previousIds.length <= 1, `Conflicting statuses on booth ${number}; manual decision required`);
    const statusId = previousIds[0] || null;
    const statusIdsByType = { ...assignment.statusIdsByType };
    delete statusIdsByType[compliance.id];
    // Explicit null prevents a previously cleared legacy status from resurfacing.
    statusIdsByType[offers.id] = statusId;
    const next = { ...assignment, statusIdsByType };
    assert.equal(statusIdForType(next, mergedType), statusId, `Status changed on booth ${number}`);
    const { statusIdsByType: beforeTypes, ...beforeFields } = assignment;
    const { statusIdsByType: afterTypes, ...afterFields } = next;
    assert.ok(same(beforeFields, afterFields), `Unrelated assignment data changed on booth ${number}`);
    if (statusId) counts[statusId]++; else withoutStatus++;
    return [number, next];
  }));
  const next = { ...meta, assignments, statusTypes: [mergedType],
    activeStatusTypeId: offers.id, activeStatusTypeIds: [offers.id] };
  // Status objects themselves (including exact colour strings and IDs) are untouched.
  assert.ok(same(next.statusTypes[0].statuses, statuses));
  return { next, report: { category: "Status", statuses, counts, withoutStatus,
    assignmentCount: Object.keys(assignments).length, conflicts: 0 } };
}

async function main() {
  assert.ok(process.argv[2], "Supply the current verified backup directory");
  assert.ok(process.argv.slice(3).every(arg => arg === "--apply"), "Unknown argument");
  const backupDir = resolve(process.argv[2]);
  const apply = process.argv.includes("--apply");
  const manifest = JSON.parse(await readFile(resolve(backupDir, "manifest.json"), "utf8"));
  assert.equal(manifest.projectId, "truckshow-platform");
  for (const entry of manifest.maps) {
    assert.equal(sha(await readFile(resolve(backupDir, entry.filename))), entry.sha256, "Backup checksum mismatch");
  }
  const entry = manifest.maps.find(item => item.id === mapId);
  assert.ok(entry, "Working map missing from backup");
  const backup = JSON.parse(await readFile(resolve(backupDir, entry.filename), "utf8"));
  assert.equal(backup.document.title, "All Levels – Working Plans");
  const before = backup.meta.booths;
  const { next, report } = mergeWorkflowStatuses(before);
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", mapId, backupSha256: entry.sha256, ...report }, null, 2));
  if (!apply) return;
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, manifest.projectId);
  const app = initializeApp({ apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: manifest.projectId,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID });
  const db = getFirestore(app);
  try {
    const { user } = await signInAnonymously(getAuth(app));
    const metaRef = doc(db, "maps", mapId, "meta", "booths");
    const mapRef = doc(db, "maps", mapId);
    const auditRef = doc(db, "activity", operationId);
    await runTransaction(db, async tx => {
      const [live, map, audit] = await Promise.all([metaRef, mapRef, auditRef].map(ref => tx.get(ref)));
      assert.ok(!audit.exists(), "This migration has already been applied");
      assert.equal(map.data()?.title, backup.document.title, "Map identity changed");
      assert.ok(same(live.data(), before), "Booth data changed since backup; take a fresh backup and recheck");
      tx.update(metaRef, { statusTypes: next.statusTypes, assignments: next.assignments,
        activeStatusTypeId: next.activeStatusTypeId, activeStatusTypeIds: next.activeStatusTypeIds });
      tx.set(auditRef, { schemaVersion: 1, eventType: "mutation", action: "Merge Offer and Compliance status categories",
        mapId, authUid: user.uid, actor: { uid: user.uid, name: "Codex — authorized status migration", isGuest: true },
        path: `/map/${mapId}`, clientAt: Date.now(), createdAt: serverTimestamp(),
        metadata: { operationId, backupSha256: entry.sha256, statusCount: report.statuses.length,
          assignmentCount: report.assignmentCount, namesAndColoursPreserved: true } });
    });
    const [saved, audit] = await Promise.all([metaRef, auditRef].map(ref => getDocFromServer(ref)));
    assert.ok(same(saved.data(), next), "Post-write verification failed; inspect current data without retrying migration");
    assert.ok(audit.exists(), "Missing audit receipt");
    const receipt = { operationId, mapId, verifiedAt: new Date().toISOString(), backupSha256: entry.sha256,
      beforeSha256: sha(stable(before)), afterSha256: sha(stable(saved.data())), ...report };
    await writeFile(resolve(backupDir, "status-merge-receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log("APPLIED AND VERIFIED: every status name, colour, ID and booth assignment preserved. Geometry untouched.");
  } finally {
    await terminate(db);
    await deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
