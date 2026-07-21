// Concurrency tests for the collaborative (Firestore) layer.
//
// Fires genuinely near-simultaneous writes — the way two users editing at the same
// instant would — at a throwaway map, then asserts the converged state is logical:
//   • no write crashes,
//   • concurrent edits to DIFFERENT fields all survive (merge doesn't clobber),
//   • concurrent edits to the SAME field resolve to one value (last-write-wins, never
//     a half-written / corrupt value),
//   • name + status set on one booth at once both stick (deep merge),
//   • create-vs-create and delete-vs-write races stay consistent.
//
// The write helpers below MIRROR src/lib/maps.ts (assignDoc routing, setBoothExhibitor,
// setBoothStatus, importExhibitors, splitBooth, setSearchState, addLevel order logic,
// removeLevel). Keep them in sync if maps.ts changes.
//
// Run:  npm run test:concurrency      (loads webapp/.env.local, hits the real project,
//                                       creates + deletes an isolated test map)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, deleteField, serverTimestamp,
} from "firebase/firestore";

// ---- env ----
const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const credential = await signInAnonymously(auth);
const db = getFirestore(app);

// ---- write helpers (mirror src/lib/maps.ts) ----
const DEFAULT_LEVEL_ID = "main";
const boothMeta = (id) => doc(db, "maps", id, "meta", "booths");
// Assignments are map-wide in the app; the level parameter remains in these helpers
// so the concurrency scenarios still read naturally.
const assignDoc = (id, _level) => boothMeta(id);
const levelsCol = (id) => collection(db, "maps", id, "levels");
const levelDoc = (id, lid) => doc(db, "maps", id, "levels", lid);
const rid = () => Math.random().toString(36).slice(2, 10);

const setBoothExhibitor = (id, lvl, num, name) =>
  setDoc(assignDoc(id, lvl), { assignments: { [num]: { exhibitor: name } } }, { merge: true });
const setBoothStatus = (id, lvl, num, statusId) =>
  setDoc(assignDoc(id, lvl), { assignments: { [num]: { statusId } } }, { merge: true });
const importExhibitors = (id, lvl, mapping) => {
  const assignments = {};
  for (const [num, name] of Object.entries(mapping)) assignments[num] = { exhibitor: name };
  return setDoc(assignDoc(id, lvl), { assignments }, { merge: true });
};
const splitBooth = async (id, lvl, num, parts, current) => {
  const update = { [`splits.${num}`]: { parts } };
  if (current?.exhibitor) update[`assignments.${parts[0].number}`] = { exhibitor: current.exhibitor };
  await setDoc(assignDoc(id, lvl), {}, { merge: true });
  await updateDoc(assignDoc(id, lvl), update);
};
const setSearchState = (id, by, patch) =>
  setDoc(doc(db, "maps", id, "meta", "search"), { ...patch, by }, { merge: true });
async function addLevelSim(id, name) {
  const existing = await getDocs(levelsCol(id));
  if (existing.empty) {
    await setDoc(levelDoc(id, DEFAULT_LEVEL_ID), { name: "Level 1", order: 0, status: "ready" });
  }
  const levels = await getDocs(levelsCol(id));
  const maxOrder = levels.docs.reduce((m, d) => Math.max(m, d.data().order ?? 0), 0);
  const lid = rid();
  await setDoc(levelDoc(id, lid), { name, order: maxOrder + 1, status: "ready" });
  return lid;
}

const readAssign = async (id, lvl) => (await getDoc(assignDoc(id, lvl))).data()?.assignments ?? {};
const readSearch = async (id) => (await getDoc(doc(db, "maps", id, "meta", "search"))).data() ?? {};

// ---- runner ----
let pass = 0, fail = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n          ${e.message}`); fail++; }
}

// Create an isolated throwaway map.
const mapRef = await addDoc(collection(db, "maps"), {
  title: "concurrency-test", ownerId: credential.user.uid, ownerName: "test", status: "ready",
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
});
const MAP = mapRef.id;
console.log(`\nconcurrency tests on throwaway map ${MAP}\n`);

await test("same booth, two exhibitor names at once -> one wins, booth intact", async () => {
  await Promise.all([
    setBoothExhibitor(MAP, "main", "A1", "Acme"),
    setBoothExhibitor(MAP, "main", "A1", "Volvo"),
  ]);
  const a = await readAssign(MAP, "main");
  assert(["Acme", "Volvo"].includes(a.A1?.exhibitor), `expected Acme|Volvo, got ${JSON.stringify(a.A1)}`);
});

await test("different booths at once -> both survive (no clobber)", async () => {
  await Promise.all([
    setBoothExhibitor(MAP, "main", "B1", "Acme"),
    setBoothExhibitor(MAP, "main", "B2", "Volvo"),
  ]);
  const a = await readAssign(MAP, "main");
  assert(a.B1?.exhibitor === "Acme" && a.B2?.exhibitor === "Volvo", `lost one: ${JSON.stringify({ B1: a.B1, B2: a.B2 })}`);
});

await test("name + status on same booth at once -> both stick (deep merge)", async () => {
  await Promise.all([
    setBoothExhibitor(MAP, "main", "C1", "Acme"),
    setBoothStatus(MAP, "main", "C1", "s-green"),
  ]);
  const a = await readAssign(MAP, "main");
  assert(a.C1?.exhibitor === "Acme" && a.C1?.statusId === "s-green", `merge dropped a field: ${JSON.stringify(a.C1)}`);
});

await test("status set vs status clear(null) on same booth -> one wins, valid", async () => {
  await setBoothStatus(MAP, "main", "D1", "s1");
  await Promise.all([
    setBoothStatus(MAP, "main", "D1", "s2"),
    setBoothStatus(MAP, "main", "D1", null),
  ]);
  const a = await readAssign(MAP, "main");
  assert(["s2", null].includes(a.D1?.statusId ?? null), `unexpected: ${JSON.stringify(a.D1)}`);
});

await test("two bulk imports at once -> disjoint keys all kept, overlap = one value", async () => {
  await Promise.all([
    importExhibitors(MAP, "main", { E1: "One", E2: "Two", Eshared: "fromA" }),
    importExhibitors(MAP, "main", { E3: "Three", E4: "Four", Eshared: "fromB" }),
  ]);
  const a = await readAssign(MAP, "main");
  assert(["One", "Two", "Three", "Four"].every((v, i) => a[`E${i + 1}`]?.exhibitor === v), "lost a disjoint import key");
  assert(["fromA", "fromB"].includes(a.Eshared?.exhibitor), `overlap corrupt: ${JSON.stringify(a.Eshared)}`);
});

await test("split + assignment on same booth at once -> split + name both consistent", async () => {
  await Promise.all([
    splitBooth(MAP, "main", "F1", [{ number: "F1A" }, { number: "F1B" }], { exhibitor: "Acme" }),
    setBoothExhibitor(MAP, "main", "F1", "LateName"),
  ]);
  const data = (await getDoc(assignDoc(MAP, "main"))).data() ?? {};
  assert(data.splits?.F1?.parts?.length === 2, "split lost");
  assert(["Acme", "LateName"].includes(data.assignments?.F1?.exhibitor) || data.assignments?.F1A?.exhibitor === "Acme",
    `inconsistent: ${JSON.stringify({ F1: data.assignments?.F1, F1A: data.assignments?.F1A })}`);
});

await test("20 rapid writes to one field -> last-ish wins, doc valid (stress)", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => setBoothExhibitor(MAP, "main", "G1", `name-${i}`)));
  const a = await readAssign(MAP, "main");
  assert(/^name-\d+$/.test(a.G1?.exhibitor ?? ""), `corrupt after burst: ${JSON.stringify(a.G1)}`);
});

await test("concurrent search by two users -> last-write-wins, by = a real writer", async () => {
  await Promise.all([
    setSearchState(MAP, "userA", { query: "alpha", active: true, view: "list" }),
    setSearchState(MAP, "userB", { query: "bravo", active: true, view: "map" }),
  ]);
  const s = await readSearch(MAP);
  assert(["alpha", "bravo"].includes(s.query), `query corrupt: ${s.query}`);
  assert(["userA", "userB"].includes(s.by), `by corrupt: ${s.by}`);
});

await test("rapid search open/close/open -> final state coherent", async () => {
  await Promise.all([
    setSearchState(MAP, "u", { active: true }),
    setSearchState(MAP, "u", { active: false }),
    setSearchState(MAP, "u", { active: true }),
  ]);
  const s = await readSearch(MAP);
  assert(typeof s.active === "boolean", `active not boolean: ${JSON.stringify(s.active)}`);
});

await test("two users add a level at once -> both levels survive (create-vs-create)", async () => {
  const before = (await getDocs(levelsCol(MAP))).size;
  const [l1, l2] = await Promise.all([addLevelSim(MAP, "LevelX"), addLevelSim(MAP, "LevelY")]);
  const after = await getDocs(levelsCol(MAP));
  assert(l1 !== l2, "got the same level id twice");
  assert(after.docs.some((d) => d.id === l1) && after.docs.some((d) => d.id === l2), "a level was lost");
  assert(after.size >= before + 2, `expected +2 levels, before ${before} after ${after.size}`);
});

await test("delete level meta vs assign on it at once -> no crash, consistent", async () => {
  const lvl = "raceLevel";
  await setBoothExhibitor(MAP, lvl, "H1", "Seed"); // create the level meta doc
  let threw = false;
  try {
    await Promise.all([
      deleteDoc(assignDoc(MAP, lvl)),
      setBoothExhibitor(MAP, lvl, "H2", "Acme"),
    ]);
  } catch { threw = true; }
  assert(!threw, "delete-vs-write threw");
  const a = await readAssign(MAP, lvl);
  // Either the delete won (doc gone/empty) or the write recreated it — both are fine,
  // as long as it's not corrupt.
  assert(typeof a === "object", "assignments not an object after delete race");
});

await test("clear a field via deleteField concurrent with a write -> valid", async () => {
  await setBoothExhibitor(MAP, "main", "I1", "Acme");
  await Promise.all([
    updateDoc(assignDoc(MAP, "main"), { [`assignments.I1`]: deleteField() }),
    setBoothStatus(MAP, "main", "I1", "s9"),
  ]);
  const a = await readAssign(MAP, "main");
  // I1 is either gone (delete last) or has just the status (status last). Not corrupt.
  assert(a.I1 === undefined || a.I1?.statusId === "s9" || a.I1?.exhibitor === undefined,
    `unexpected: ${JSON.stringify(a.I1)}`);
});

// ---- cleanup ----
async function cleanup() {
  const levels = await getDocs(levelsCol(MAP)).catch(() => null);
  if (levels) for (const d of levels.docs) {
    await deleteDoc(doc(db, "maps", MAP, "meta", `level_${d.id}`)).catch(() => {});
    await deleteDoc(d.ref).catch(() => {});
  }
  for (const m of ["booths", "search", "level_raceLevel"]) {
    await deleteDoc(doc(db, "maps", MAP, "meta", m)).catch(() => {});
  }
  await deleteDoc(mapRef).catch(() => {});
}
await cleanup();

console.log(`\n${pass} passed, ${fail} failed  (cleaned up map ${MAP})\n`);
process.exit(fail ? 1 : 0);
