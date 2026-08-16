#!/usr/bin/env node

// One-time, idempotent correction for the BCEC drafting error that enclosed booths
// 188 and 189 in a single booth-189 polygon. The script validates live render geometry
// before writing and changes only `splits.189` in each matching map's booth metadata.
// Run without --apply for a read-only preview.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { doc, getDoc, getFirestore, writeBatch } from "firebase/firestore";

async function loadEnv(path) {
  const text = await readFile(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

await loadEnv(resolve(".env.local"));
const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
await signInAnonymously(getAuth(app));
const db = getFirestore(app);

const targets = [
  { id: "J3XPpvyFqQ8M4hYj4jtY", levelId: "wwcxq3na", title: "BCEC — All Levels (test)" },
  { id: "mbIptVJvpeDJqNuqRiqD", levelId: "dh55kwpe", title: "BCEC — All Levels v11 update" },
  { id: "xDUYA9nxn7ThMmYcJXhZ", levelId: "ztgu6h0r", title: "All Levels – Working Plans" },
];

const split = {
  parts: [
    {
      number: "188",
      polygon: [249457.8, 7457.8, 259457.8, 7457.8, 259457.8, 25457.8, 249457.8, 25457.8],
      centroid: [254457.8, 16457.8],
      width_m: 10,
      depth_m: 18,
      area_m2: 180,
    },
    {
      number: "189",
      polygon: [259457.8, 7457.8, 268457.8, 7457.8, 268457.8, 25457.8, 259457.8, 25457.8],
      centroid: [263957.8, 16457.8],
      width_m: 9,
      depth_m: 18,
      area_m2: 162,
    },
  ],
};

function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
}

const expectedSource = JSON.stringify([
  [268457.8, 25457.8],
  [249457.8, 25457.8],
  [249457.8, 7457.8],
  [268457.8, 7457.8],
]);
const existingExpected = stableJson(split);
const ready = [];

for (const target of targets) {
  const metaRef = doc(db, "maps", target.id, "meta", "booths");
  const renderRef = doc(db, "maps", target.id, "render", target.levelId);
  const [metaSnap, renderSnap] = await Promise.all([getDoc(metaRef), getDoc(renderRef)]);
  if (!metaSnap.exists() || !renderSnap.exists()) throw new Error(`${target.title}: required document is missing`);
  const meta = metaSnap.data();
  const booths = JSON.parse(renderSnap.data().boothsJson || "{}").booths || [];
  const booth189 = booths.find((booth) => booth.number === "189" && Array.isArray(booth.polygon));
  const booth188 = booths.find((booth) => booth.number === "188");
  if (!booth189 || JSON.stringify(booth189.polygon) !== expectedSource) {
    throw new Error(`${target.title}: booth 189 geometry differs; refusing to write`);
  }
  if (!booth188 || booth188.polygon !== null) {
    throw new Error(`${target.title}: expected label-only booth 188; refusing to write`);
  }
  if (meta.assignments?.["188"]) throw new Error(`${target.title}: booth 188 already has data; refusing to overwrite`);
  const existing = meta.splits?.["189"];
  if (existing && stableJson(existing) !== existingExpected) {
    throw new Error(`${target.title}: booth 189 already has a different split; refusing to overwrite`);
  }
  ready.push({ ...target, metaRef, assignment189: meta.assignments?.["189"] ?? null, alreadyFixed: !!existing });
}

console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "preview", targets: ready.map(({ metaRef: _, ...target }) => target) }, null, 2));

if (process.argv.includes("--apply")) {
  const batch = writeBatch(db);
  for (const target of ready) {
    if (!target.alreadyFixed) batch.update(target.metaRef, { "splits.189": split });
  }
  await batch.commit();
  for (const target of ready) {
    const saved = (await getDoc(target.metaRef)).data()?.splits?.["189"];
    if (stableJson(saved) !== existingExpected) throw new Error(`${target.title}: post-write verification failed`);
  }
  console.log(`Verified booth 188/189 as separate geometry in ${ready.length} maps.`);
}

await deleteApp(app);
