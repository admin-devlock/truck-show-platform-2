"use client";

import { useEffect, useRef, useState } from "react";
import { getMapBackup, restoreMap, type MapBackup, type MapDoc } from "@/lib/maps";
import type { Identity } from "@/lib/auth";
import { downloadBlob, safeName } from "@/lib/export";

/** Download a full, self-contained backup of a map (all levels + data). */
export async function downloadMapBackup(map: MapDoc) {
  const backup = await getMapBackup(map);
  const json = JSON.stringify(backup, null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), `${safeName(map.title)}.backup.json`);
}

/** Push a backup snapshot to the host filesystem (off-Firestore fallback store). */
export async function saveBackupToServer(map: MapDoc): Promise<boolean> {
  try {
    const backup = await getMapBackup(map);
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapId: map.id, backup }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Restore a map from an uploaded backup file. Returns the new map id. */
export async function restoreFromFile(user: Identity, file: File): Promise<string> {
  const text = await file.text();
  let parsed: MapBackup;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn’t valid JSON.");
  }
  return await restoreMap(user, parsed);
}

/**
 * Regularly back the open map up to the host filesystem: once shortly after it loads,
 * then on a fixed interval while it stays open. Keeps the fallback copy fresh so the
 * map is recoverable if Firestore/the website fails. Returns the last successful time.
 */
export function useAutoBackup(map: MapDoc | null | undefined, ready: boolean, intervalMs = 5 * 60_000) {
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!map || !ready) return;
    let alive = true;
    const run = async () => {
      const m = mapRef.current;
      if (!m) return;
      const ok = await saveBackupToServer(m);
      if (ok && alive) setLastBackupAt(Date.now());
    };
    const first = setTimeout(run, 8_000); // shortly after load
    const timer = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [map?.id, ready, intervalMs]);

  return lastBackupAt;
}
