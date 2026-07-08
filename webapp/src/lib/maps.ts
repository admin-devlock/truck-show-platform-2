// Firestore + Storage helpers for "maps" (a map == a collaborative doc).
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  deleteField,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Identity } from "./auth";

export type MapStatus = "processing" | "ready" | "error";

export type MapDoc = {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  ownerPhoto: string | null;
  status: MapStatus;
  svgUrl: string | null; // where the rendered floorplan SVG lives (bundled sample only)
  thumbSvg: string | null; // small inline SVG thumbnail for the dashboard card
  sourceFile: string | null; // original CAD filename
  boothCount: number | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

const mapsCol = collection(db, "maps");

/** Live-subscribe to all maps, newest first. Returns an unsubscribe fn. */
export function subscribeMaps(cb: (maps: MapDoc[]) => void) {
  const q = query(mapsCol, orderBy("updatedAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MapDoc, "id">) })));
  });
}

/** Live-subscribe to a single map doc. */
export function subscribeMap(id: string, cb: (m: MapDoc | null) => void) {
  return onSnapshot(doc(db, "maps", id), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<MapDoc, "id">) }) : null);
  });
}

export async function getMap(id: string): Promise<MapDoc | null> {
  const snap = await getDoc(doc(db, "maps", id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<MapDoc, "id">) }) : null;
}

/** Create a map that points at an already-rendered SVG (e.g. the bundled sample). */
export async function createMapFromSvg(
  user: Identity,
  title: string,
  svgUrl: string,
  boothCount: number | null = null,
): Promise<string> {
  const docRef = await addDoc(mapsCol, {
    title,
    ownerId: user.uid,
    ownerName: user.name,
    ownerPhoto: user.photo,
    status: "ready" as MapStatus,
    svgUrl,
    thumbSvg: null,
    sourceFile: null,
    boothCount,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export type MapRender = {
  svg: string;
  // Booth data is stored as a JSON string: Firestore rejects nested arrays, and each
  // booth has a polygon (array of [x,y] pairs). Parse when needed (click-to-inspect).
  boothsJson: string;
  viewBox: [number, number] | null;
};

/** Subscribe to a level's rendered floorplan (subdoc, to keep the main doc light). */
export function subscribeRender(id: string, levelId: string, cb: (r: MapRender | null) => void) {
  return onSnapshot(doc(db, "maps", id, "render", levelId), (snap) => {
    cb(snap.exists() ? (snap.data() as MapRender) : null);
  });
}

/** One-shot read of a level's booth records (parsed from its render doc). Empty for
 *  sample levels that render from svgUrl. Used to search/aggregate across all levels. */
export async function getRenderBooths(id: string, levelId: string): Promise<unknown[]> {
  const snap = await getDoc(doc(db, "maps", id, "render", levelId));
  if (!snap.exists()) return [];
  try {
    return (JSON.parse((snap.data() as MapRender).boothsJson).booths as unknown[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * Create a map by uploading a CAD file and converting it server-side.
 *
 * Flow: create the doc (processing) → POST the file to /api/convert, which runs the
 * libredwg→JSON→SVG pipeline on the host → store the rendered SVG + booth data in a
 * render subdoc and flip the map to "ready". On failure the map is marked "error".
 */
export async function createMapFromUpload(
  user: Identity,
  title: string,
  file: File,
): Promise<string> {
  const docRef = await addDoc(mapsCol, {
    title,
    ownerId: user.uid,
    ownerName: user.name,
    ownerPhoto: user.photo,
    status: "processing" as MapStatus,
    svgUrl: null,
    thumbSvg: null,
    sourceFile: file.name,
    boothCount: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Convert in the background so the caller can navigate straight to the map; the
  // viewer subscribes to the doc and flips from "Converting…" to the floorplan live.
  void convertAndStore(docRef.id, file);
  return docRef.id;
}

async function convertAndStore(id: string, file: File) {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/convert", { method: "POST", body: fd });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(error || `HTTP ${res.status}`);
    }
    const { svg, thumbSvg, booths, boothCount } = await res.json();
    const viewBox =
      booths && Array.isArray(booths.viewBox) ? (booths.viewBox as [number, number]) : null;

    await setDoc(doc(db, "maps", id, "render", "main"), {
      svg,
      boothsJson: JSON.stringify(booths),
      viewBox,
    });
    await updateDoc(doc(db, "maps", id), {
      status: "ready" as MapStatus,
      thumbSvg: thumbSvg || null,
      boothCount: boothCount ?? null,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    await updateDoc(doc(db, "maps", id), {
      status: "error" as MapStatus,
      error: String(e),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

export async function renameMap(id: string, title: string) {
  await updateDoc(doc(db, "maps", id), { title, updatedAt: serverTimestamp() });
}

/** Delete a map and all its subdocs (levels, renders, meta). Presence docs expire. */
export async function deleteMap(id: string) {
  // Per-level renders + level docs.
  const levels = await getDocs(collection(db, "maps", id, "levels")).catch(() => null);
  if (levels) {
    for (const d of levels.docs) {
      await deleteDoc(doc(db, "maps", id, "render", d.id)).catch(() => {});
      await deleteDoc(doc(db, "maps", id, "meta", `level_${d.id}`)).catch(() => {});
      await deleteDoc(d.ref).catch(() => {});
    }
  }
  // The default level's render + booth meta + shared search state.
  await deleteDoc(doc(db, "maps", id, "render", DEFAULT_LEVEL_ID)).catch(() => {});
  await deleteDoc(boothMeta(id)).catch(() => {});
  await deleteDoc(doc(db, "maps", id, "meta", "search")).catch(() => {});
  await deleteDoc(doc(db, "maps", id));
}

// ---------------------------------------------------------------------------
// Booth management: exhibitor names + statuses, assigned per booth.
//
// All of it lives in one collaborative doc `maps/{id}/meta/booths` (live-synced;
// any collaborator can edit). Assignments are keyed by booth NUMBER (string) — the
// stable identity that survives a CAD re-import, so relabelled/re-rendered maps keep
// their data where numbers match.
// ---------------------------------------------------------------------------
export type BoothStatus = { id: string; name: string; color: string };
export type StatusType = { id: string; name: string; statuses: BoothStatus[] };
export type BoothAssignment = {
  exhibitor?: string;
  statusId?: string | null;
  // What the small metric line on the booth's map label shows: its area (default)
  // or its width × depth. Absent = "area".
  labelMode?: "area" | "dims";
};

// Adaptability: a booth can be split in half in-app (e.g. it was subdivided after the
// CAD was drawn). A split replaces the source booth with two independently-assignable
// parts; it's reversible. Stored per-level alongside assignments, keyed by source number.
export type SplitPart = {
  number: string;
  polygon: number[]; // FLAT [x0,y0,x1,y1,...] — Firestore rejects nested arrays
  centroid: [number, number];
  width_m: number | null;
  depth_m: number | null;
  area_m2: number | null;
};
export type BoothSplit = { parts: SplitPart[] };

export type BoothData = {
  assignments: Record<string, BoothAssignment>;
  statusTypes: StatusType[];
  activeStatusTypeId: string | null;
  splits: Record<string, BoothSplit>;
};

// Status types AND booth assignments (exhibitor + status) are MAP-WIDE: one exhibitor
// and one status per booth NUMBER across the whole map (numbers are unique across the
// levels), so search / filtering / counts all span every level. It all lives in the
// single collaborative doc `maps/{id}/meta/booths`.
const boothMeta = (id: string) => doc(db, "maps", id, "meta", "booths");
export const DEFAULT_LEVEL_ID = "main";

/** Subscribe to the map-wide assignments + splits + status types. */
export function subscribeBoothData(id: string, cb: (d: BoothData) => void) {
  return onSnapshot(boothMeta(id), (snap) => {
    const d = (snap.data() as Partial<BoothData>) || {};
    cb({
      assignments: d.assignments ?? {},
      statusTypes: d.statusTypes ?? [],
      activeStatusTypeId: d.activeStatusTypeId ?? null,
      splits: d.splits ?? {},
    });
  });
}

/**
 * Split a booth into two halves. The source booth's existing assignment moves to the
 * first part. Parts are independently assignable thereafter. Reversible via unsplitBooth.
 */
export async function splitBooth(
  id: string,
  sourceNumber: string,
  parts: SplitPart[],
  currentAssignment?: BoothAssignment,
) {
  if (parts.length < 2) throw new Error("A split needs at least two parts.");
  if (new Set(parts.map((p) => p.number)).size !== parts.length)
    throw new Error("Split part numbers must differ.");
  const update: Record<string, unknown> = {
    [`splits.${sourceNumber}`]: { parts },
  };
  // Carry the source's exhibitor/status onto the first half so nothing is lost.
  if (currentAssignment && (currentAssignment.exhibitor || currentAssignment.statusId)) {
    update[`assignments.${parts[0].number}`] = {
      ...(currentAssignment.exhibitor ? { exhibitor: currentAssignment.exhibitor } : {}),
      ...(currentAssignment.statusId ? { statusId: currentAssignment.statusId } : {}),
    };
  }
  await setDoc(boothMeta(id), {}, { merge: true }); // ensure doc exists
  await updateDoc(boothMeta(id), update);
}

/** Undo a split, restoring the original booth. */
export async function unsplitBooth(id: string, sourceNumber: string) {
  await updateDoc(boothMeta(id), { [`splits.${sourceNumber}`]: deleteField() });
}

export async function setBoothExhibitor(id: string, boothNumber: string, exhibitor: string) {
  await setDoc(boothMeta(id), { assignments: { [boothNumber]: { exhibitor } } }, { merge: true });
}

export async function setBoothStatus(id: string, boothNumber: string, statusId: string | null) {
  await setDoc(boothMeta(id), { assignments: { [boothNumber]: { statusId } } }, { merge: true });
}

/** Per-booth label metric: show area (m², the default) or width × depth on the map. */
export async function setBoothLabelMode(id: string, boothNumber: string, labelMode: "area" | "dims") {
  await setDoc(boothMeta(id), { assignments: { [boothNumber]: { labelMode } } }, { merge: true });
}

export async function saveStatusTypes(id: string, statusTypes: StatusType[]) {
  await setDoc(boothMeta(id), { statusTypes }, { merge: true });
}

export async function setActiveStatusType(id: string, activeStatusTypeId: string | null) {
  await setDoc(boothMeta(id), { activeStatusTypeId }, { merge: true });
}

// ---------------------------------------------------------------------------
// Collaborative search: the search query, view mode and open/closed state are shared,
// so a search one person runs shows up for everyone. (Navigation — which map and which
// level — stays per-user; matches are computed locally by each viewer for its level.)
// `by` is the uid of the last writer, so a client ignores the echo of its own writes.
// ---------------------------------------------------------------------------
export type SearchState = {
  query: string;
  active: boolean;
  view: "list" | "map";
  statusFilter: string[]; // statusIds to include; empty = any status
  by: string;
};
const searchDoc = (id: string) => doc(db, "maps", id, "meta", "search");

export function subscribeSearch(id: string, cb: (s: SearchState) => void) {
  return onSnapshot(searchDoc(id), (snap) => {
    const d = (snap.data() as Partial<SearchState>) || {};
    cb({
      query: d.query ?? "",
      active: d.active ?? false,
      view: d.view ?? "list",
      statusFilter: Array.isArray(d.statusFilter) ? d.statusFilter : [],
      by: d.by ?? "",
    });
  });
}

export async function setSearchState(
  id: string,
  by: string,
  patch: Partial<Omit<SearchState, "by">>,
) {
  await setDoc(searchDoc(id), { ...patch, by }, { merge: true }).catch(() => {});
}

/** One-shot read of the map-wide assignments + status types. */
export async function getBoothDataOnce(id: string): Promise<BoothData> {
  const snap = await getDoc(boothMeta(id));
  const d = (snap.data() as Partial<BoothData>) || {};
  return {
    assignments: d.assignments ?? {},
    statusTypes: d.statusTypes ?? [],
    activeStatusTypeId: d.activeStatusTypeId ?? null,
    splits: d.splits ?? {},
  };
}

/**
 * Bulk-assign exhibitor names by booth number (e.g. from an imported list). Merges
 * into existing assignments, so a booth's status is preserved.
 */
export async function importExhibitors(id: string, mapping: Record<string, string>) {
  const assignments: Record<string, BoothAssignment> = {};
  for (const [num, name] of Object.entries(mapping)) {
    assignments[num] = { exhibitor: name.trim() };
  }
  if (Object.keys(assignments).length === 0) return;
  await setDoc(boothMeta(id), { assignments }, { merge: true });
}

/**
 * Copy exhibitor assignments from another map into this one, keyed by booth number.
 * When `includeStatuses` is true the source's status-type definitions are copied too
 * (so the copied statusIds resolve) and each booth's status is carried over.
 */
export async function copyAssignmentsFromMap(
  targetId: string,
  sourceId: string,
  includeStatuses: boolean,
) {
  const source = await getBoothDataOnce(sourceId);
  const assignments: Record<string, BoothAssignment> = {};
  for (const [num, a] of Object.entries(source.assignments)) {
    const next: BoothAssignment = {};
    if (a.exhibitor?.trim()) next.exhibitor = a.exhibitor.trim();
    if (includeStatuses && a.statusId) next.statusId = a.statusId;
    if (Object.keys(next).length) assignments[num] = next;
  }
  await setDoc(boothMeta(targetId), { assignments }, { merge: true });
  if (includeStatuses) {
    await setDoc(
      boothMeta(targetId),
      { statusTypes: source.statusTypes, activeStatusTypeId: source.activeStatusTypeId },
      { merge: true },
    );
  }
  return Object.keys(assignments).length;
}

// ---------------------------------------------------------------------------
// Levels: a map can hold multiple CAD floorplans (e.g. Plaza / Mezzanine / Halls).
// Each level is a doc in `maps/{id}/levels/{levelId}` with its own render subdoc at
// `render/{levelId}`. Assignments are NOT per-level — they're map-wide in meta/booths
// (keyed by booth number, which is unique across levels; see subscribeBoothData above).
//
// Legacy maps (created before levels) have no `levels` docs; the viewer synthesizes a
// single default level from the map doc, whose render is `render/main`. Adding a level
// to such a map first "promotes" that default level into the subcollection.
// ---------------------------------------------------------------------------
export type Level = {
  id: string;
  name: string;
  sourceFile: string | null;
  svgUrl: string | null; // bundled sample only
  status: MapStatus;
  boothCount: number | null;
  thumbSvg: string | null;
  order: number;
  error?: string;
};

const levelsCol = (id: string) => collection(db, "maps", id, "levels");
const levelDoc = (id: string, levelId: string) => doc(db, "maps", id, "levels", levelId);
const newId = () => Math.random().toString(36).slice(2, 10);

/** Derive the synthesized default level from a map doc (for legacy single-level maps). */
function defaultLevelFromMap(map: MapDoc): Level {
  return {
    id: DEFAULT_LEVEL_ID,
    name: "Level 1",
    sourceFile: map.sourceFile ?? null,
    svgUrl: map.svgUrl ?? null,
    status: map.status ?? "ready",
    boothCount: map.boothCount ?? null,
    thumbSvg: map.thumbSvg ?? null,
    order: 0,
  };
}

/**
 * Subscribe to a map's levels. If the `levels` subcollection is empty, yields a single
 * synthesized default level derived from the map doc, so the viewer always has ≥1 level.
 */
export function subscribeLevels(map: MapDoc, cb: (levels: Level[]) => void) {
  return onSnapshot(query(levelsCol(map.id), orderBy("order", "asc")), (snap) => {
    if (snap.empty) {
      cb([defaultLevelFromMap(map)]);
      return;
    }
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Level, "id">) })));
  });
}

export async function getLevelsOnce(map: MapDoc): Promise<Level[]> {
  const snap = await getDocs(query(levelsCol(map.id), orderBy("order", "asc")));
  if (snap.empty) return [defaultLevelFromMap(map)];
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Level, "id">) }));
}

/** Write the synthesized default level into the subcollection if it isn't there yet. */
async function promoteDefaultLevel(map: MapDoc) {
  const existing = await getDocs(levelsCol(map.id));
  if (!existing.empty) return;
  const lvl = defaultLevelFromMap(map);
  await setDoc(levelDoc(map.id, DEFAULT_LEVEL_ID), {
    name: lvl.name,
    sourceFile: lvl.sourceFile,
    svgUrl: lvl.svgUrl,
    status: lvl.status,
    boothCount: lvl.boothCount,
    thumbSvg: lvl.thumbSvg,
    order: 0,
  });
}

/** Add a new CAD level to a map and convert it in the background. */
export async function addLevel(map: MapDoc, name: string, file: File): Promise<string> {
  await promoteDefaultLevel(map); // ensure the original level is represented first
  const levels = await getDocs(levelsCol(map.id));
  const maxOrder = levels.docs.reduce((m, d) => Math.max(m, (d.data().order as number) ?? 0), 0);
  const levelId = newId();
  await setDoc(levelDoc(map.id, levelId), {
    name: name.trim() || file.name,
    sourceFile: file.name,
    svgUrl: null,
    status: "processing" as MapStatus,
    boothCount: null,
    thumbSvg: null,
    order: maxOrder + 1,
  });
  await updateDoc(doc(db, "maps", map.id), { updatedAt: serverTimestamp() });
  void convertAndStoreLevel(map.id, levelId, file);
  return levelId;
}

/** Replace a level's CAD file (re-convert). Assignments survive (keyed by booth number). */
export async function replaceLevelCad(map: MapDoc, levelId: string, file: File) {
  await promoteDefaultLevel(map);
  await updateDoc(levelDoc(map.id, levelId), {
    sourceFile: file.name,
    status: "processing" as MapStatus,
  });
  void convertAndStoreLevel(map.id, levelId, file);
}

async function convertAndStoreLevel(mapId: string, levelId: string, file: File) {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/convert", { method: "POST", body: fd });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(error || `HTTP ${res.status}`);
    }
    const { svg, thumbSvg, booths, boothCount } = await res.json();
    const viewBox =
      booths && Array.isArray(booths.viewBox) ? (booths.viewBox as [number, number]) : null;
    await setDoc(doc(db, "maps", mapId, "render", levelId), {
      svg,
      boothsJson: JSON.stringify(booths),
      viewBox,
    });
    await updateDoc(levelDoc(mapId, levelId), {
      status: "ready" as MapStatus,
      thumbSvg: thumbSvg || null,
      boothCount: boothCount ?? null,
    });
    await updateDoc(doc(db, "maps", mapId), { updatedAt: serverTimestamp() });
  } catch (e) {
    await updateDoc(levelDoc(mapId, levelId), {
      status: "error" as MapStatus,
      error: String(e),
    }).catch(() => {});
  }
}

export async function renameLevel(mapId: string, levelId: string, name: string) {
  await updateDoc(levelDoc(mapId, levelId), { name });
}

// ---------------------------------------------------------------------------
// Backup & recovery: a map's entire state (levels, rendered SVGs, booth data,
// exhibitor assignments and statuses) serialized to a single self-contained JSON.
// Because the rendered SVG + booth records are embedded, a restore needs NO CAD file
// and NO re-conversion — it rebuilds the map directly. This is the "accessible fallback
// format" that survives a Firestore/website failure (also auto-saved to disk; see
// /api/backup), and the basis for recovery.
// ---------------------------------------------------------------------------
export type LevelBackup = {
  name: string;
  sourceFile: string | null;
  svgUrl: string | null;
  boothCount: number | null;
  thumbSvg: string | null;
  order: number;
  render: MapRender | null;
  // Legacy per-level backups carried these; assignments/splits are now map-wide (below).
  assignments?: Record<string, BoothAssignment>;
  splits?: Record<string, BoothSplit>;
};
export type MapBackup = {
  version: 1;
  exportedAt: string;
  title: string;
  statusTypes: StatusType[];
  activeStatusTypeId: string | null;
  assignments: Record<string, BoothAssignment>; // map-wide, keyed by booth number
  splits: Record<string, BoothSplit>;
  levels: LevelBackup[];
};

/** Read a map's complete state (all levels + renders + map-wide assignments + statuses). */
export async function getMapBackup(map: MapDoc): Promise<MapBackup> {
  const levels = await getLevelsOnce(map);
  const metaSnap = await getDoc(boothMeta(map.id));
  const meta = (metaSnap.data() as Partial<BoothData>) || {};

  const levelBackups: LevelBackup[] = await Promise.all(
    levels.map(async (lvl) => {
      const renderSnap = await getDoc(doc(db, "maps", map.id, "render", lvl.id));
      return {
        name: lvl.name,
        sourceFile: lvl.sourceFile ?? null,
        svgUrl: lvl.svgUrl ?? null,
        boothCount: lvl.boothCount ?? null,
        thumbSvg: lvl.thumbSvg ?? null,
        order: lvl.order ?? 0,
        render: renderSnap.exists() ? (renderSnap.data() as MapRender) : null,
      };
    }),
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    title: map.title,
    statusTypes: meta.statusTypes ?? [],
    activeStatusTypeId: meta.activeStatusTypeId ?? null,
    assignments: meta.assignments ?? {},
    splits: meta.splits ?? {},
    levels: levelBackups.sort((a, b) => a.order - b.order),
  };
}

/** Rebuild a map from a backup JSON. Creates a fresh map doc + all levels/renders/data. */
export async function restoreMap(
  user: Identity,
  backup: MapBackup,
  titleOverride?: string,
): Promise<string> {
  if (!backup || backup.version !== 1 || !Array.isArray(backup.levels)) {
    throw new Error("Not a valid map backup file.");
  }
  const first = backup.levels[0];
  const mapRef = await addDoc(mapsCol, {
    title: titleOverride ?? (backup.title ? `${backup.title} (restored)` : "Restored map"),
    ownerId: user.uid,
    ownerName: user.name,
    ownerPhoto: user.photo,
    status: "ready" as MapStatus,
    svgUrl: first?.svgUrl ?? null,
    thumbSvg: first?.thumbSvg ?? null,
    sourceFile: first?.sourceFile ?? null,
    boothCount: first?.boothCount ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const mapId = mapRef.id;

  // Map-wide status types + assignments + splits. (Old backups stored assignments/splits
  // per level; fold those in for backward compatibility.)
  const assignments: Record<string, BoothAssignment> = { ...(backup.assignments ?? {}) };
  const splits: Record<string, BoothSplit> = { ...(backup.splits ?? {}) };
  for (const lvl of backup.levels) {
    Object.assign(assignments, lvl.assignments ?? {});
    Object.assign(splits, lvl.splits ?? {});
  }
  await setDoc(boothMeta(mapId), {
    statusTypes: backup.statusTypes ?? [],
    activeStatusTypeId: backup.activeStatusTypeId ?? null,
    assignments,
    splits,
  });

  // Levels (first becomes the default "main" level to match the storage convention).
  for (let i = 0; i < backup.levels.length; i++) {
    const lvl = backup.levels[i];
    const levelId = i === 0 ? DEFAULT_LEVEL_ID : newId();
    await setDoc(levelDoc(mapId, levelId), {
      name: lvl.name,
      sourceFile: lvl.sourceFile ?? null,
      svgUrl: lvl.svgUrl ?? null,
      status: "ready" as MapStatus,
      boothCount: lvl.boothCount ?? null,
      thumbSvg: lvl.thumbSvg ?? null,
      order: lvl.order ?? i,
    });
    if (lvl.render) {
      await setDoc(doc(db, "maps", mapId, "render", levelId), {
        svg: lvl.render.svg,
        boothsJson: lvl.render.boothsJson,
        viewBox: lvl.render.viewBox ?? null,
      });
    }
  }
  return mapId;
}

/** Duplicate a map: a full deep copy (all levels, renders, assignments, statuses,
 *  splits) into a new "<title> (copy)" map. Returns the new map id. */
export async function duplicateMap(user: Identity, map: MapDoc): Promise<string> {
  const backup = await getMapBackup(map);
  return restoreMap(user, backup, `${map.title} (copy)`);
}

/** Remove a level (its render). Refuses to remove the last level. Map-wide assignments
 *  are keyed by booth number and left intact (harmless if the level is re-added). */
export async function removeLevel(map: MapDoc, levelId: string) {
  await promoteDefaultLevel(map);
  const levels = await getDocs(levelsCol(map.id));
  if (levels.size <= 1) throw new Error("A map must keep at least one level.");
  await deleteDoc(doc(db, "maps", map.id, "render", levelId)).catch(() => {});
  await deleteDoc(levelDoc(map.id, levelId));
  await updateDoc(doc(db, "maps", map.id), { updatedAt: serverTimestamp() });
}
