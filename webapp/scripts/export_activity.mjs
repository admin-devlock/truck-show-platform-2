#!/usr/bin/env node

// Read-only export of the activity audit trail for local analysis.
// Run from webapp/: npm run export:activity -- [options]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  limit as firestoreLimit,
  orderBy,
  query,
} from "firebase/firestore";

const DEFAULT_LIMIT = 2000;

function usage() {
  return `Export the activity audit trail as JSON, CSV, and an aggregate summary.

Usage:
  npm run export:activity -- [options]

Options:
  --limit <number>   Pull the latest N events (default: ${DEFAULT_LIMIT})
  --all              Pull the entire activity collection
  --map <map-id>     Keep only events for one map
  --user <uid>       Keep only events for one Firebase user
  --since <date>     Keep events at/after an ISO date or timestamp
  --until <date>     Keep events at/before an ISO date or timestamp
  --output <dir>     Write to this directory instead of the timestamped default
  --help              Show this help

Filters are applied locally after the bounded Firestore pull. Use --all when a
filter must search the complete history.
`;
}

function parseArgs(argv) {
  const options = {
    all: false,
    limit: DEFAULT_LIMIT,
    map: null,
    user: null,
    since: null,
    until: null,
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { ...options, help: true };
    if (flag === "--all") {
      options.all = true;
      continue;
    }
    if (!["--limit", "--map", "--user", "--since", "--until", "--output"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    index += 1;
    options[flag.slice(2)] = value;
  }

  const parsedLimit = Number(options.limit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
    throw new Error("--limit must be a positive whole number");
  }
  options.limit = parsedLimit;

  for (const key of ["since", "until"]) {
    if (options[key] == null) continue;
    const timestamp = Date.parse(options[key]);
    if (Number.isNaN(timestamp)) throw new Error(`--${key} must be a valid date or timestamp`);
    options[key] = new Date(timestamp);
  }
  if (options.since && options.until && options.since > options.until) {
    throw new Error("--since must be before --until");
  }

  return options;
}

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

function timestampToIso(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function normalizeEvent(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    createdAt: timestampToIso(data.createdAt) || timestampToIso(data.clientAt),
    clientAt: timestampToIso(data.clientAt),
    eventType: data.eventType || null,
    action: data.action || null,
    mapId: data.mapId || null,
    path: data.path || null,
    sessionId: data.sessionId || null,
    authUid: data.authUid || null,
    actor: {
      uid: data.actor?.uid || data.authUid || null,
      name: data.actor?.name || null,
      isGuest: Boolean(data.actor?.isGuest),
    },
    metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {},
    schemaVersion: data.schemaVersion || null,
  };
}

function countBy(events, keyFor) {
  const counts = new Map();
  for (const event of events) {
    const key = keyFor(event);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function buildSummary(events, exportedAt, projectId, pull) {
  const dated = events.filter((event) => event.createdAt);
  return {
    format: "truck-show-activity-summary-v1",
    exportedAt,
    projectId,
    pull,
    totalEvents: events.length,
    firstEventAt: dated.at(-1)?.createdAt || null,
    lastEventAt: dated[0]?.createdAt || null,
    byAction: countBy(events, (event) => event.action),
    byEventType: countBy(events, (event) => event.eventType),
    byMap: countBy(events, (event) => event.mapId),
    byUser: countBy(events, (event) => event.actor.uid),
    byDay: countBy(events, (event) => event.createdAt?.slice(0, 10)),
  };
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(events) {
  const columns = [
    "id",
    "createdAt",
    "clientAt",
    "eventType",
    "action",
    "mapId",
    "path",
    "sessionId",
    "actorUid",
    "actorName",
    "isGuest",
    "authUid",
    "metadataJson",
  ];
  const rows = events.map((event) => [
    event.id,
    event.createdAt,
    event.clientAt,
    event.eventType,
    event.action,
    event.mapId,
    event.path,
    event.sessionId,
    event.actor.uid,
    event.actor.name,
    event.actor.isGuest,
    event.authUid,
    JSON.stringify(event.metadata),
  ]);
  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

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

try {
  await signInAnonymously(getAuth(app));
  const db = getFirestore(app);
  const activity = collection(db, "activity");
  const activityQuery = options.all
    ? query(activity, orderBy("createdAt", "desc"))
    : query(activity, orderBy("createdAt", "desc"), firestoreLimit(options.limit));
  const snapshot = await getDocs(activityQuery);

  const events = snapshot.docs
    .map(normalizeEvent)
    .filter((event) => !options.map || event.mapId === options.map)
    .filter((event) => !options.user || event.actor.uid === options.user || event.authUid === options.user)
    .filter((event) => !options.since || (event.createdAt && new Date(event.createdAt) >= options.since))
    .filter((event) => !options.until || (event.createdAt && new Date(event.createdAt) <= options.until));

  const exportedAt = new Date().toISOString();
  const stamp = exportedAt.replace(/[:.]/g, "-");
  const outputDir = resolve(options.output || `activity-exports/activity-export-${stamp}`);
  await mkdir(outputDir, { recursive: true });

  const pull = {
    mode: options.all ? "all" : "latest",
    requestedLimit: options.all ? null : options.limit,
    documentsRead: snapshot.size,
    filters: {
      map: options.map,
      user: options.user,
      since: options.since?.toISOString() || null,
      until: options.until?.toISOString() || null,
    },
  };
  const payload = {
    format: "truck-show-activity-export-v1",
    exportedAt,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    pull,
    eventCount: events.length,
    events,
  };

  await Promise.all([
    writeFile(resolve(outputDir, "activity.json"), `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" }),
    writeFile(resolve(outputDir, "activity.csv"), buildCsv(events), { flag: "wx" }),
    writeFile(
      resolve(outputDir, "summary.json"),
      `${JSON.stringify(buildSummary(events, exportedAt, payload.projectId, pull), null, 2)}\n`,
      { flag: "wx" },
    ),
  ]);

  console.log(JSON.stringify({ outputDir, documentsRead: snapshot.size, eventsExported: events.length }, null, 2));
} catch (error) {
  if (error?.code === "permission-denied") {
    throw new Error(
      "Firestore denied access to the activity collection. Publish the activity rules in webapp/firestore.rules, then retry.",
      { cause: error },
    );
  }
  throw error;
} finally {
  await deleteApp(app);
}
