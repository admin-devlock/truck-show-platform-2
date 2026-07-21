#!/usr/bin/env node

// Read-only disaster-recovery export of every map visible to an authenticated user.
// Usage: node scripts/backup_all_maps.mjs [output-directory]

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { collection, getDocs, getFirestore } from "firebase/firestore";

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

function jsonValue(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return { __timestamp: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(jsonValue);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const safeFile = (text) => text.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "map";

await loadEnv(resolve(".env.local"));

const required = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env.local`);
}

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

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = resolve(process.argv[2] || `../backups/map-export-${stamp}`);
await mkdir(outputDir, { recursive: true });

const mapSnapshot = await getDocs(collection(db, "maps"));
const manifest = {
  format: "truck-show-raw-firestore-export-v1",
  exportedAt: new Date().toISOString(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  mapCount: mapSnapshot.size,
  maps: [],
};

for (const mapDoc of mapSnapshot.docs) {
  const subcollections = {};
  for (const name of ["levels", "render", "meta"]) {
    const snap = await getDocs(collection(db, "maps", mapDoc.id, name));
    subcollections[name] = Object.fromEntries(
      snap.docs.map((entry) => [entry.id, jsonValue(entry.data())]),
    );
  }
  const payload = {
    format: "truck-show-raw-map-export-v1",
    exportedAt: manifest.exportedAt,
    id: mapDoc.id,
    document: jsonValue(mapDoc.data()),
    ...subcollections,
  };
  const json = JSON.stringify(payload, null, 2) + "\n";
  const filename = `${safeFile(String(mapDoc.data().title || "untitled"))}.${mapDoc.id}.json`;
  await writeFile(resolve(outputDir, filename), json, { encoding: "utf8", flag: "wx" });

  // Verify that the file is readable JSON and byte-for-byte identical to what was written.
  const saved = await readFile(resolve(outputDir, filename), "utf8");
  JSON.parse(saved);
  if (saved !== json) throw new Error(`Verification failed for ${filename}`);
  manifest.maps.push({
    id: mapDoc.id,
    title: mapDoc.data().title || "Untitled",
    filename,
    bytes: Buffer.byteLength(saved),
    sha256: sha256(saved),
    levels: Object.keys(subcollections.levels).length,
    renders: Object.keys(subcollections.render).length,
    metaDocuments: Object.keys(subcollections.meta).length,
  });
}

const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
await writeFile(resolve(outputDir, "manifest.json"), manifestJson, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputDir, ...manifest }, null, 2));
await deleteApp(app);
